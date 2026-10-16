import fs from "node:fs";
import { redactCredentialText } from "./privacy.mjs";
import { checkAnswer, outcomeContract } from "./outcomes.mjs";
import { blockerKinds } from "./tool-schemas.mjs";
import path from "node:path";
import crypto from "node:crypto";

const secretKey =
  /pass(word)?|token|secret|authorization|api[-_]?key|cookie|credential/i;
export function redact(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactCredentialText(value);
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        secretKey.test(k) && !(k === "pass" && typeof v === "boolean")
          ? "[REDACTED]"
          : redact(v),
      ]),
    );
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
function json(value, limit = 10000) {
  return JSON.stringify(redact(value)).slice(0, limit);
}
function explicitInitialTextAcknowledgement(value) {
  if (typeof value !== "string") return false;
  return (
    /\b(?:initial|first)\b/i.test(value) &&
    /\btext[- ]only\b/i.test(value) &&
    /\b(?:acknowledg\w*|early[_ -]?stop)\b/i.test(value)
  );
}
function nativeInitialTextObservation(event) {
  if (event.tool !== "assistant_output" || event.error !== false) return false;
  try {
    const result = JSON.parse(event.result);
    return (
      result?.source ===
        "Actual Pi assistant output; not independent proof of external state" &&
      typeof result.text === "string" &&
      result.emittedWithToolCalls === false &&
      result.priorToolResults === 0
    );
  } catch {
    return false;
  }
}

export function atomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${crypto.randomUUID()}`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.renameSync(temp, file);
}

export class Controller {
  constructor(root, nc, limits = {}) {
    this.root = root;
    this.nc = nc;
    this.limits = { turns: 80, ...limits };
    this.queues = new Map();
  }
  checkpoint(id) {
    const f = `${this.root}/state/executions/${id}.json`;
    if (!fs.existsSync(f))
      return { id, started: Date.now(), turns: 0, evidence: [], failures: {} };
    try {
      return JSON.parse(fs.readFileSync(f, "utf8"));
    } catch (error) {
      const corrupt = `${f}.corrupt-${Date.now()}`;
      try {
        fs.copyFileSync(f, corrupt);
      } catch {}
      const backup = `${f}.bak`;
      if (fs.existsSync(backup)) {
        try {
          return JSON.parse(fs.readFileSync(backup, "utf8"));
        } catch {}
      }
      throw new Error(`Execution state corrupt for ${id}`, { cause: error });
    }
  }
  save(c) {
    atomic(`${this.root}/state/executions/${c.id}.json`, c);
  }
  beginSlice(id, now = Date.now()) {
    const cp = this.checkpoint(id);
    if (cp.paused === "resource_limit") {
      cp.legacyResourcePause = {
        retries: cp.retries,
        turns: cp.turns,
        modelTurns: cp.modelTurns,
      };
      delete cp.paused;
    }
    cp.totalTurns = (cp.totalTurns || 0) + (cp.turns || 0);
    cp.totalModelTurns = (cp.totalModelTurns || 0) + (cp.modelTurns || 0);
    cp.turns = 0;
    cp.modelTurns = 0;
    cp.state = "running";
    cp.sliceStarted = now;
    cp.lastRunAt = now;
    cp.slices = (cp.slices || 0) + 1;
    cp.attemptId = crypto.randomUUID();
    cp.attempts = [
      ...(cp.attempts || []),
      { id: cp.attemptId, started: now, strategy: cp.strategyGeneration || 0 },
    ].slice(-100);
    this.save(cp);
    return cp;
  }
  yieldSlice(id, reason = "slice_budget", now = Date.now()) {
    const cp = this.checkpoint(id);
    if (cp.attemptId && cp.lastYieldAttemptId === cp.attemptId)
      return { continue: false, reason: cp.state, nextRunAt: cp.nextRunAt };
    cp.lastYieldAttemptId = cp.attemptId;
    const meaningful = cp.evidence.filter(
      (e) =>
        !e.error &&
        ![
          "assistant_output",
          "goal_state",
          "goal_plan",
          "goal_verify",
          "goal_blocker",
          "goal_unblock",
        ].includes(e.tool),
    );
    const progress = crypto
      .createHash("sha256")
      .update(
        JSON.stringify(
          [
            ...new Set(
              meaningful.map((e) => JSON.stringify([e.tool, e.args, e.result])),
            ),
          ].sort(),
        ),
      )
      .digest("hex");
    cp.ineffectiveSlices =
      progress === cp.progressFingerprint
        ? (cp.ineffectiveSlices || 0) + 1
        : meaningful.length
          ? 0
          : 1;
    cp.progressFingerprint = progress;
    if (cp.ineffectiveSlices >= 3) {
      cp.recoveryInstruction =
        "Diagnose the unchanged outcome before further execution. Choose a substantively different permitted approach, not repeated identical calls. Preserve unverified criteria.";
      cp.strategyGeneration = (cp.strategyGeneration || 0) + 1;
      this.save(cp);
      return this.deferFailure(
        id,
        "Repeated slices made no observable progress",
        now,
        "ineffective_strategy",
      );
    }
    cp.state = "yielded";
    cp.yieldReason = reason;
    cp.nextRunAt = now;
    cp.elapsedMs =
      (cp.elapsedMs || 0) + Math.max(0, now - (cp.sliceStarted || now));
    const attempt = cp.attempts?.find((a) => a.id === cp.attemptId);
    if (attempt)
      Object.assign(attempt, { ended: now, outcome: "yielded", reason });
    this.save(cp);
    return { continue: false, reason: "yielded" };
  }
  deferFailure(id, error, now = Date.now(), state = "transient_failure") {
    const cp = this.checkpoint(id);
    cp.retries = (cp.retries || 0) + 1;
    cp.strategyAttempts = (cp.strategyAttempts || 0) + 1;
    if (cp.strategyAttempts >= (this.limits.maxRetries || 3)) {
      cp.strategyGeneration = (cp.strategyGeneration || 0) + 1;
      cp.strategyAttempts = 0;
      cp.recoveryInstruction =
        "Diagnose the recorded failure before executing. Do not repeat the ineffective approach. Recheck dependency readiness, use a substantively different permitted route, or a measured suitable model. Do not weaken verification or permissions.";
    }
    cp.state = state;
    cp.lastError = redact(String(error));
    cp.nextRunAt =
      now +
      Math.min(
        this.limits.maxBackoffMs || 900000,
        (this.limits.retryBackoffMs || 5000) *
          2 ** Math.min(cp.retries - 1, 12),
      );
    const attempt = cp.attempts?.find((a) => a.id === cp.attemptId);
    if (attempt) Object.assign(attempt, { ended: now, outcome: state });
    this.save(cp);
    return { continue: false, reason: state, nextRunAt: cp.nextRunAt };
  }
  eligible(id, now = Date.now()) {
    const cp = this.checkpoint(id);
    return (
      (!cp.paused || cp.paused === "resource_limit") &&
      (!cp.nextRunAt || cp.nextRunAt <= now)
    );
  }
  async lock(id, fn) {
    const prior = this.queues.get(id) || Promise.resolve();
    const job = prior.catch(() => {}).then(fn);
    this.queues.set(id, job);
    try {
      return await job;
    } finally {
      if (this.queues.get(id) === job) this.queues.delete(id);
    }
  }
  async create(request, sessionFile, model) {
    const id = crypto.randomUUID();
    const goal = await this.nc.put({
      id,
      kind: "goal",
      title: request.slice(0, 150),
      request,
      status: "NEEDS-ACTION",
      created: new Date().toISOString(),
    });
    this.save({ ...this.checkpoint(id), sessionFile, model });
    return goal;
  }
  validateCriteria(criteria) {
    if (!Array.isArray(criteria) || !criteria.length || criteria.length > 20)
      throw Error("Expected 1..20 criteria");
    return criteria.map((t) => {
      if (
        !t ||
        Object.keys(t).some((k) => !["title", "verifier"].includes(k)) ||
        !t.title ||
        !t.verifier ||
        Object.keys(t.verifier).some(
          (k) => !["kind", "path", "text"].includes(k),
        ) ||
        !["file_contains", "evidence_review", "answer_quality"].includes(
          t.verifier.kind,
        )
      )
        throw Error("Measurable verifier required");
      if (
        t.verifier.kind === "file_contains" &&
        (typeof t.verifier.path !== "string" ||
          typeof t.verifier.text !== "string" ||
          !t.verifier.text)
      )
        throw Error("Measurable verifier required");
      return { title: t.title, verifier: { ...t.verifier } };
    });
  }
  async assertExecution(id) {
    if (this.executionGuard) await this.executionGuard(id);
  }
  async plan(id, criteria, signal, review) {
    return this.lock(id, async () => {
      signal?.throwIfAborted();
      const g = await this.nc.get(id, signal);
      if (g.invalid || ["COMPLETED", "CANCELLED"].includes(g.status))
        throw Error("Goal is terminal");
      const clean = this.validateCriteria(criteria);
      if (g.planReady && (g.planRevision || 1) === (g.revision || 1)) {
        const currentPlan = crypto
          .createHash("sha256")
          .update(JSON.stringify(g.planRevision ? [g.revision || 1, canonical(clean)] : canonical(clean)))
          .digest("hex")
          .slice(0, 24);
        if (g.planId !== currentPlan) throw Error("Plan already exists");
      }
      if (
        clean.some((t) => t.verifier.kind === "answer_quality") &&
        !(g.requestHistory?.length ? g.requestHistory : [{text:g.request,images:this.checkpoint(id).inputImages}]).every(request =>
          ["answer", "arithmetic"].includes(outcomeContract(request.text, Boolean(request.images?.length)).kind))
      )
        throw Error(
          "Answer contract cannot verify an external or composite outcome; actual evidence required",
        );
      if (review) {
        const verdict = await review(g, clean);
        if (
          verdict?.pass !== true ||
          typeof verdict.reason !== "string" ||
          !verdict.reason.trim()
        )
          throw Error(
            "Independent plan coverage rejected: " +
              (verdict?.reason || "missing verdict"),
          );
        g.planReview = { ...verdict, reviewedAt: new Date().toISOString() };
      }
      const planId = crypto
        .createHash("sha256")
        .update(JSON.stringify([g.revision || 1, canonical(clean)]))
        .digest("hex")
        .slice(0, 24);
      const existingTasks = await this.nc.list(signal);
      const expected = clean.map((criterion, i) => {
        const prior = existingTasks.find(
          (task) => task.kind === "criterion" && task.parent === id &&
            (!g.expectedChildIds || g.expectedChildIds.includes(task.id)) &&
            task.title === criterion.title &&
            JSON.stringify(canonical(task.verifier)) === JSON.stringify(canonical(criterion.verifier)),
        );
        return prior?.id || crypto.createHash("sha256").update(`${id}:${g.revision || 1}:${planId}:${i}`).digest("hex").slice(0, 32);
      });
      if (!g.planReady || (g.planRevision || 1) !== (g.revision || 1)) {
        await this.assertExecution(id);
        await this.nc.put(
          { ...g, planId, planRevision: g.revision || 1, expectedChildIds: expected, planReady: true },
          g.etag,
          signal,
        );
      }
      await this.assertExecution(id);
      const result = [];
      for (let i = 0; i < clean.length; i++) {
        signal?.throwIfAborted();
        const existing = (await this.nc.list(signal)).find(
          (t) => t.id === expected[i],
        );
        if (!existing) await this.assertExecution(id);
        result.push(
          existing ||
            (await this.nc.put(
              {
                ...clean[i],
                id: expected[i],
                kind: "criterion",
                parent: id,
                status: "NEEDS-ACTION",
              },
              undefined,
              signal,
            )),
        );
      }
      return result;
    });
  }
  async applyPlanning(id, decision, revision, signal) {
    const before = await this.nc.get(id, signal);
    if ((before.revision || 1) !== revision || ["COMPLETED", "CANCELLED"].includes(before.status)) throw Error("Stale planning decision");
    if (decision.execution === "complete") {
      await this.assertExecution(id);
      return this.nc.put({...before,status:"COMPLETED",completionKind:"user-directed",completedAt:new Date().toISOString(),lease:null,needsPlanning:false,execution:{...before.execution,state:"completed",nextRunAt:0}}, before.etag, signal);
    }
    const clean = this.validateCriteria(decision.criteria);
    const previous = (await this.nc.list(signal)).filter(t => t.kind === "criterion" && t.parent === id && (!before.expectedChildIds || before.expectedChildIds.includes(t.id)));
    await this.plan(id, clean, signal);
    await this.assertExecution(id);
    const current = await this.nc.get(id, signal);
    if ((current.revision || 1) !== revision) throw Error("Stale planning decision");
    const paused = decision.execution === "pause" || (before.paused && !["resume", "complete"].includes(decision.execution));
    const next = {
      ...current, title: decision.title, description: decision.description, request: decision.description,
      subgoals: decision.subgoals, needsPlanning: false, paused,
      planChanges: decision.changes, plannedStrategyGeneration: this.checkpoint(id).strategyGeneration || 0,
      planRevisions: [...(before.planRevisions || []), {
        at: new Date().toISOString(), revision, previousDescription: before.description || before.request,
        previousPlanId: before.planId || null, changes: decision.changes,
        criteria: previous.map(t => ({...t, accepted: Boolean(this.criterionAccepted(before,t)), disposition: current.expectedChildIds.includes(t.id) ? "retained" : "superseded"}))
      }],
      execution: {...current.execution, state: paused ? "paused" : "running"}
    };
    if (decision.execution === "complete") {
      next.status = "COMPLETED"; next.completionKind = "user-directed";
      next.completedAt = new Date().toISOString(); next.lease = null;
    }
    return this.nc.put(next, current.etag, signal);
  }
  safeFile(relative) {
    const base = path.resolve(`${this.root}/work`),
      p = path.resolve(base, relative),
      real = fs.realpathSync(p);
    if (!p.startsWith(`${base}/`) || !real.startsWith(`${base}/`))
      throw Error("Unauthorized verifier path");
    return real;
  }
  async verify(id, taskId, review, signal) {
    return this.lock(id, async () => {
      signal?.throwIfAborted();
      const g = await this.nc.get(id, signal);
      if (g.invalid || ["CANCELLED", "COMPLETED"].includes(g.status))
        throw Error("Goal is terminal");
      const t = await this.nc.get(taskId, signal);
      if (t.invalid || t.parent !== id || (g.expectedChildIds && !g.expectedChildIds.includes(taskId))) throw Error("Wrong goal or superseded criterion");
      const v = t.verifier;
      let evidence;
      if (v.kind === "answer_quality") {
        const event = this.checkpoint(id)
          .evidence.filter((e) => e.tool === "assistant_output" && !e.error)
          .at(-1);
        let output;
        try {
          output = JSON.parse(event?.result || "null");
        } catch {}
        if (
          !output?.final ||
          output.source !==
            "Actual Pi assistant output; not independent proof of external state"
        )
          throw Error("Native final answer required");
        const requests = g.requestHistory?.length ? g.requestHistory : [{text:g.request,images:this.checkpoint(id).inputImages}];
        const contracts = requests.map(request => outcomeContract(request.text, Boolean(request.images?.length)));
        if (!contracts.every(contract => ["answer", "arithmetic"].includes(contract.kind)))
          throw Error("Explicit evidence-backed criteria required");
        if (requests.length > 1 && !this.answerReviewer)
          throw Error("Independent review required for combined informational requests");
        // The mutable description may summarize several simple requests. It is
        // not a new external-effect contract. For combined answers, the separate
        // deep operation checks every contributing request and current criterion.
        const verdict = checkAnswer(requests.length === 1 ? requests[0].text : "Explain a concept", output.text);
        if (!verdict.pass) throw Error(verdict.reason);
        if (requests.length > 1) {
          const expectedResults = contracts.filter(contract => contract.kind === "arithmetic").map(contract => contract.expected);
          const numbers = output.text.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
          if (expectedResults.some(expected => !numbers.includes(expected)))
            throw Error("Combined answer lacks an independently computed arithmetic result");
          verdict.expectedResults = expectedResults;
        }
        if (this.answerReviewer) {
          const independent = await this.answerReviewer(g,t,event,signal);
          if (independent?.pass !== true || typeof independent.reason !== "string" || !independent.reason.trim()) throw Error("Independent answer review rejected: " + (independent?.reason || "invalid verdict"));
          verdict.independentReview = independent;
        }
        evidence = {
          kind: v.kind,
          ...verdict,
          evidenceIds: [event.id],
          answerSha256: crypto
            .createHash("sha256")
            .update(output.text)
            .digest("hex"),
        };
      } else if (v.kind === "file_contains") {
        const data = fs.readFileSync(this.safeFile(v.path), "utf8");
        if (!v.text || !data.includes(v.text))
          throw Error("Criterion not satisfied");
        evidence = {
          kind: v.kind,
          path: v.path,
          sha256: crypto.createHash("sha256").update(data).digest("hex"),
        };
      } else if (v.kind === "evidence_review") {
        const all = this.checkpoint(id).evidence;
        const initialCriterion =
          explicitInitialTextAcknowledgement(t.title) &&
          explicitInitialTextAcknowledgement(g.request);
        const actual = all.filter(
          (e) =>
            ![
              "goal_plan",
              "goal_state",
              "goal_verify",
              "goal_unblock",
              "assistant_output",
            ].includes(e.tool) &&
            (e.tool !== "goal_blocker" || e.error === true),
        );
        const initial = initialCriterion
          ? all.filter(nativeInitialTextObservation)
          : [];
        const events = initialCriterion ? initial : actual;
        if (!events.length || !review)
          throw Error("Independent reviewer and actual tool evidence required");
        const r = await review(t, events, g);
        if (
          r.pass !== true ||
          !r.reason ||
          !r.evidenceIds?.length ||
          r.evidenceIds.some((x) => !events.some((e) => e.id === x)) ||
          (initialCriterion &&
            !r.evidenceIds.some((x) => initial.some((e) => e.id === x)))
        )
          throw Error("Independent review did not substantiate criterion");
        evidence = { kind: v.kind, ...r };
      } else throw Error("Verifier not implemented");
      signal?.throwIfAborted();
      await this.assertExecution(id);
      const latestGoal = await this.nc.get(id, signal);
      if (latestGoal.status !== "NEEDS-ACTION" || latestGoal.paused || (latestGoal.revision || 1) !== (g.revision || 1) || latestGoal.planId !== g.planId || !latestGoal.planReady) throw Error("Goal is terminal, paused or plan superseded");
      // Stage evidence without publishing completion. Acceptance is fenced by
      // the parent goal ETag, which changes on cancellation or lease takeover.
      const verificationId = crypto.randomUUID();
      const staged = await this.nc.put(
        {
          ...t,
          status: "NEEDS-ACTION",
          evidence: {
            ...evidence,
            verifiedAt: new Date().toISOString(),
            verificationId,
          },
        },
        t.etag,
        signal,
      );
      await this.assertExecution(id);
      const publicationGoal = await this.nc.get(id, signal);
      if (publicationGoal.status !== "NEEDS-ACTION")
        throw Error("Goal is terminal");
      if (
        publicationGoal.lease?.token !== latestGoal.lease?.token ||
        publicationGoal.etag !== latestGoal.etag
      )
        throw Error("Stale verification lease or parent version");
      // CalDAV has no multi-resource transaction. Child status is provisional
      // until the final parent CAS accepts its exact verification receipt.
      // No child mutation follows that acceptance linearization point.
      const updated = await this.nc.put(
        { ...staged, status: "COMPLETED" },
        staged.etag,
        signal,
      );
      if (
        updated.status !== "COMPLETED" ||
        updated.evidence?.verificationId !== verificationId
      )
        throw Error("Verification readback failed");
      await this.assertExecution(id);
      const accepted = await this.nc.put(
        {
          ...publicationGoal,
          verificationReceipts: {
            ...publicationGoal.verificationReceipts,
            [taskId]: verificationId,
          },
        },
        publicationGoal.etag,
        signal,
      );
      if (accepted.verificationReceipts?.[taskId] !== verificationId)
        throw Error("Verification acceptance readback failed");
      // A delayed response cannot turn cancellation into acceptance at the caller.
      const confirmed = await this.nc.get(id, signal);
      if (
        confirmed.status !== "NEEDS-ACTION" ||
        confirmed.lease?.token !== publicationGoal.lease?.token
      )
        throw Error("Goal is terminal or verification lease changed");
      return updated;
    });
  }
  deny(id, tool, args, reason) {
    if (id)
      this.record(id, tool, args, { policy: "execution_guard", reason }, true);
    return { block: true, reason };
  }
  failureKey(tool, args, id) {
    let revision = null;
    if (tool === "goal_verify" && id) {
      const facts = this.checkpoint(id)
        .evidence.filter(
          (e) =>
            ![
              "goal_plan",
              "goal_state",
              "goal_verify",
              "goal_unblock",
              "assistant_output",
            ].includes(e.tool) &&
            (e.tool !== "goal_blocker" || e.error === true),
        )
        .map((e) => {
          try {
            return JSON.parse(e.result).policy === "execution_guard"
              ? JSON.stringify([e.tool, e.args, e.result])
              : e.id;
          } catch {
            return e.id;
          }
        });
      revision = [...new Set(facts)].sort();
    }
    return crypto
      .createHash("sha256")
      .update(
        JSON.stringify(
          canonical(
            revision === null
              ? [tool, redact(args)]
              : [tool, redact(args), revision],
          ),
        ),
      )
      .digest("hex");
  }
  record(id, tool, args, result, error = false, dispatchedKey) {
    const cp = this.checkpoint(id);
    const safeArgs = redact(args),
      safeResult = redact(result);
    const fingerprint = dispatchedKey || this.failureKey(tool, args, id);
    if (error) cp.failures[fingerprint] = (cp.failures[fingerprint] || 0) + 1;
    const e = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      tool,
      args: json(safeArgs),
      result: json(safeResult),
      error,
    };
    cp.evidence.push(e);
    cp.evidence = cp.evidence.slice(-100);
    this.save(cp);
    return e;
  }
  async unblock(id, review) {
    return this.lock(id, async () => {
      const g = await this.nc.get(id);
      if (g.status !== "NEEDS-ACTION" || g.blocker?.kind !== "dependency")
        throw Error(
          "Only a recoverable dependency blocker can be cleared autonomously",
        );
      const events = this.checkpoint(id).evidence.filter(
        (e) =>
          !g.blocker.evidenceIds.includes(e.id) &&
          Date.parse(e.at) >= Date.parse(g.blocker.at) &&
          !e.error &&
          ![
            "goal_plan",
            "goal_state",
            "goal_verify",
            "goal_blocker",
            "goal_unblock",
            "assistant_output",
          ].includes(e.tool),
      );
      if (!events.length || !review)
        throw Error("New actual recovery evidence required");
      const verdict = await review(g, events);
      if (verdict?.pass !== true || !verdict.reason)
        throw Error("Recovery is not substantiated");
      const next = {
        ...g,
        lastRecovery: {
          review: verdict,
          evidenceIds: events.map((e) => e.id),
          at: new Date().toISOString(),
        },
      };
      delete next.blocker;
      await this.assertExecution(id);
      return this.nc.put(next, g.etag);
    });
  }
  async lifecycle(id, action) {
    if (!["pause","resume","cancel","complete"].includes(action)) throw Error("Invalid lifecycle action");
    for (let attempt=0; attempt<3; attempt++) {
      const g = await this.nc.get(id);
      if (g.invalid) throw Error("Invalid goal");
      if (["COMPLETED","CANCELLED"].includes(g.status)) {
        if ((action === "complete" && g.status === "COMPLETED") || (action === "cancel" && g.status === "CANCELLED")) return g;
        throw Error("Goal is terminal");
      }
      if (action === "resume" && !g.paused) return g;
      if (action === "pause" && g.paused) return g;
      const at = new Date().toISOString();
      const next = {...g, lease:null, revision:(g.revision || 1)+1,
        lifecycleHistory:[...(g.lifecycleHistory || []),{action,at}],
        paused:action === "pause",
        needsPlanning:action === "resume",
        execution:{...g.execution,state:({pause:"paused",resume:"queued",cancel:"cancelled",complete:"completed"})[action],nextRunAt:0}};
      if (action === "complete") Object.assign(next,{status:"COMPLETED",completionKind:"user-directed",completedAt:at});
      if (action === "cancel") Object.assign(next,{status:"CANCELLED",cancelledAt:at});
      try {return await this.nc.put(next,g.etag);} catch(error) {if(!/409|412/.test(error.message)||attempt===2)throw error;}
    }
  }
  pause(id) {return this.lifecycle(id,"pause");}
  resumeGoal(id) {return this.lifecycle(id,"resume");}
  complete(id, kind="user-directed") {
    if(kind!=="user-directed") throw Error("Verified completion requires accepted criteria through settle");
    return this.lifecycle(id,"complete");
  }
  cancel(id) {return this.lifecycle(id,"cancel");}
  async blocker(id, p, review) {
    return this.lock(id, async () => {
      const g = await this.nc.get(id);
      if (["COMPLETED", "CANCELLED"].includes(g.status))
        throw Error("Goal is terminal");
      const allEvidence = this.checkpoint(id).evidence;
      const events = allEvidence.filter(
        (e) =>
          p.evidenceIds?.includes(e.id) &&
          ![
            "goal_plan",
            "goal_state",
            "goal_verify",
            "goal_blocker",
            "goal_unblock",
            "assistant_output",
          ].includes(e.tool),
      );
      const unknownIds = p.evidenceIds?.filter(
        (eid) => !allEvidence.some((e) => e.id === eid),
      );
      const ownerPolicy =
        p.kind === "authorization" &&
        events.some((e) => {
          try {
            const value = JSON.parse(e.result);
            return (
              value.policy === "owner_authorization" &&
              g.authorizations?.some(
                (a) =>
                  a.id === value.requestId &&
                  a.tool === e.tool &&
                  ["pending", "denied"].includes(a.state),
              )
            );
          } catch {
            return false;
          }
        });
      const denial = /403|401|permission|authorization|safety|not authorized/i;
      const safety = p.kind === "safety";
      const commonBlockerValid =
        blockerKinds.includes(p.kind) &&
        typeof p.reason === "string" &&
        p.reason.trim() &&
        Array.isArray(p.alternatives) &&
        p.alternatives.length > 0;
      const distinctActualEvents =
        events.length >= (ownerPolicy ? 1 : 2) &&
        new Set(events.map((e) => JSON.stringify([e.tool, e.args]))).size >=
          (ownerPolicy ? 1 : 2);
      if (safety && unknownIds?.length)
        throw Error(
          "Denial evidence reference not found: " + unknownIds.join(", "),
        );
      if (
        !commonBlockerValid ||
        (!safety && !distinctActualEvents) ||
        (safety &&
          (events.length < 2 ||
            new Set(events.map((e) => JSON.stringify([e.tool, e.args]))).size <
              2))
      )
        throw Error(
          `Unsubstantiated blocker: real evidence from distinct alternatives is required; use UUIDs from goal_state().evidence, not memory note IDs or tool-call IDs. Current evidence: ${allEvidence
            .slice(-10)
            .map((e) => `${e.id} (${e.tool})`)
            .join(", ")}`,
        );
      if (safety) {
        const selfAuthored =
          /^(?:write|write_file|edit|edit_file|append|append_file|log|logger)/i;
        const anchors = events.filter(
          (e) => e.error && !selfAuthored.test(e.tool) && denial.test(e.result),
        );
        if (
          anchors.length < 2 ||
          new Set(anchors.map((e) => JSON.stringify([e.tool, e.args]))).size < 2
        )
          throw Error(
            "Unsubstantiated blocker: two distinct actual denial anchors are required",
          );
        const supplemental = events.filter(
          (e) =>
            !(e.error && !selfAuthored.test(e.tool) && denial.test(e.result)),
        );
        if (supplemental.length && !review)
          throw Error(
            "Independent blocker review required for supplemental safety evidence",
          );
      }
      if (
        ["authorization"].includes(p.kind) &&
        !ownerPolicy &&
        (!events.every((e) => e.error) ||
          !events.every((e) => denial.test(e.result)))
      )
        throw Error("Unsubstantiated authorization boundary");
      if (
        (ownerPolicy ||
          ["information", "dependency"].includes(p.kind) ||
          (safety &&
            events.some((e) => {
              const selfAuthored =
                /^(?:write|write_file|edit|edit_file|append|append_file|log|logger)/i;
              return !(
                e.error &&
                !selfAuthored.test(e.tool) &&
                denial.test(e.result)
              );
            }))) &&
        !review
      )
        throw Error("Independent blocker review required");
      let verdict;
      if (review) {
        verdict = await review(g, p, events);
        if (verdict?.pass !== true || !verdict.reason)
          throw Error(
            "Independent reviewer rejected blocker: " +
              (verdict?.reason || "unsupported"),
          );
      }
      await this.assertExecution(id);
      return this.nc.put(
        {
          ...g,
          blocker: { ...p, review: verdict, at: new Date().toISOString() },
          status: "NEEDS-ACTION",
        },
        g.etag,
      );
    });
  }

  criterionAccepted(goal, criterion) {
    return (
      criterion.status === "COMPLETED" &&
      criterion.evidence?.verifiedAt &&
      (!criterion.evidence.verificationId ||
        goal.verificationReceipts?.[criterion.id] ===
          criterion.evidence.verificationId)
    );
  }
  async settle(id) {
    const current = await this.nc.get(id);
    if (current.invalid)
      return { continue: false, reason: "invalid_goal" };
    if (
      current.status === "NEEDS-ACTION" &&
      !current.blocker && !current.paused && !current.needsPlanning &&
      current.planReady
    ) {
      const pending = (await this.nc.list()).filter(
        (t) =>
          t.parent === id && (!current.expectedChildIds || current.expectedChildIds.includes(t.id)) &&
          !this.criterionAccepted(current, t) &&
          t.verifier?.kind === "answer_quality",
      );
      for (const criterion of pending) {
        try {
          await this.verify(id, criterion.id);
        } catch (error) {
          if (
            !/Native final answer required|No substantive answer|Answer lacks/.test(
              error.message,
            )
          )
            throw error;
        }
      }
    }
    return this.lock(id, async () => {
      const g = await this.nc.get(id),
        cp = this.checkpoint(id);
      if (g.status === "CANCELLED")
        return { continue: false, reason: "cancelled" };
      if (g.status === "COMPLETED") return { continue: false, reason: g.completionKind === "user-directed" ? "user_completed" : "verified_complete" };
      if (g.paused) return { continue: false, reason: "paused" };
      if (g.needsPlanning || (g.planRevision && g.planRevision !== (g.revision || 1))) return { continue: true, reason: "replan", instruction: "The deep planner must incorporate current instructions before execution." };
      if (g.blocker)
        return { continue: false, reason: "blocked", blocker: g.blocker };
      const tasks = await this.nc.list();
      const expected = Array.isArray(g.expectedChildIds)
        ? g.expectedChildIds
        : [];
      const planned = tasks.filter((t) => t.parent === id && expected.includes(t.id));
      const complete =
        g.planReady &&
        expected.length > 0 &&
        planned.length === expected.length &&
        new Set(planned.map((t) => t.id)).size === expected.length &&
        expected.every((x) =>
          planned.some((t) => t.id === x && this.criterionAccepted(g, t)),
        );
      if (complete) {
        await this.assertExecution(id);
        if (g.status !== "COMPLETED") {
          const confirmed = await this.nc.put(
            { ...g, status: "COMPLETED", completionKind: "verified", completedAt: new Date().toISOString() },
            g.etag,
          );
          if (confirmed.status !== "COMPLETED")
            throw Error("Goal readback failed");
        }
        return { continue: false, reason: "verified_complete" };
      }
      if (g.status === "COMPLETED")
        return { continue: false, reason: "invalid_completion" };
      if (
        cp.state === "running" &&
        (cp.modelTurns >= (this.limits.maxModelTurns ?? 80) ||
          cp.turns >= this.limits.turns)
      )
        return this.yieldSlice(id, "turn_budget");
      if (!this.eligible(id))
        return {
          continue: false,
          reason: cp.paused || cp.state,
          nextRunAt: cp.nextRunAt,
        };
      cp.turns++;
      this.save(cp);
      return {
        continue: true,
        reason: Object.values(cp.failures).some((n) => n >= 2)
          ? "reconsider_strategy"
          : "unfinished",
        remaining: expected
          .map((x) => planned.find((t) => t.id === x))
          .filter(Boolean)
          .filter((t) => !this.criterionAccepted(g, t)),
        instruction: expected.length
          ? "Criteria remain incomplete. Execute meaningful work and independently verify each."
          : "Formulate criteria using goal_plan. Prose cannot complete a goal.",
      };
    });
  }
}
