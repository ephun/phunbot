import crypto from "node:crypto";

const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const terminal = (goal) => ["COMPLETED", "CANCELLED"].includes(goal.status);
export function openParentAmbiguities(goals) {
  const byConversation = new Map();
  for (const goal of goals.filter((item) => item.kind === "goal" && !item.parent && item.conversationId)) {
    if (terminal(goal)) continue;
    const list = byConversation.get(goal.conversationId) || [];
    list.push(goal.id);
    byConversation.set(goal.conversationId, list);
  }
  return [...byConversation.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([conversationId, goalIds]) => ({ conversationId, goalIds }));
}
export function dryRunGoalMigration(goals, catalog, checkpoint = () => ({})) {
  const assignments = [], unmapped = [], conflicts = [];
  const projected = goals.map(goal => {
    if (goal.kind !== "goal" || goal.parent || goal.conversationId || !catalog) return goal;
    const cp = checkpoint(goal.id);
    const candidates = catalog.filter(row=>row.goalId === goal.id || (cp.sessionFile && row.sessionFile === cp.sessionFile));
    const ids = [...new Set(candidates.map(row=>row.id))];
    if (ids.length === 1) {
      assignments.push({goalId:goal.id,conversationId:ids[0]});
      return {...goal,conversationId:ids[0]};
    }
    if (!terminal(goal)) {
      if (!ids.length) unmapped.push(goal.id);
      else conflicts.push({goalId:goal.id,conversationIds:ids});
    }
    return goal;
  });
  const ambiguities = openParentAmbiguities(projected);
  return {
    mode: "dry-run", writes: 0,
    conversations: new Set(projected.filter(goal=>goal.conversationId).map(goal=>goal.conversationId)).size,
    ambiguities,
    ...(catalog ? {assignments,unmapped,conflicts} : {}),
    safe: ambiguities.length === 0 && unmapped.length === 0 && conflicts.length === 0,
  };
}
const conflict = (error) => /412|409/.test(error.message);

/** Durable admission and bounded execution leases. Nextcloud remains authoritative. */
export class GoalQueue {
  constructor(
    nc,
    { owner = crypto.randomUUID(), leaseMs = 720000, maxActive = 2 } = {},
  ) {
    this.lastAdmission = 0;
    this.admissionJobs = new Map();
    this.nc = nc;
    this.owner = owner;
    this.leaseMs = leaseMs;
    this.maxActive = maxActive;
  }

  async optional(id) {
    try {
      return await this.nc.get(id);
    } catch (error) {
      if (/404/.test(error.message)) return null;
      throw error;
    }
  }

  async conversationGoals(conversationId) {
    return (await this.nc.list()).filter(
      (item) => item.kind === "goal" && !item.parent && item.conversationId === conversationId,
    );
  }

  async withConversationAdmissionLock(conversationId, fn) {
    // Admission is a separate CAS-protected resource. It closes the race in
    // which two processes both observe no open parent and create two parents.
    const lockId = `phunbot-conversation-${digest(conversationId).slice(0, 32)}`;
    const now = Date.now();
    const prior = await this.optional(lockId);
    if (prior?.lease?.until > now)
      throw Error("Conversation admission is already in progress");
    const token = crypto.randomUUID();
    let lock;
    try {
      lock = await this.nc.put(
        {
          ...prior,
          id: lockId,
          kind: "coordination",
          title: "phunbot conversation admission lease",
          status: "NEEDS-ACTION",
          conversationId,
          lease: { token, owner: this.owner, until: now + 120000 },
        },
        prior?.etag,
      );
    } catch (error) {
      if (conflict(error)) throw Error("Conversation admission is already in progress");
      throw error;
    }
    try {
      return await fn({
        current: () => this.nc.get(lockId),
        assertCurrent: async () => {const latest=await this.nc.get(lockId); if(latest.lease?.token!==token || latest.lease.until<=Date.now()) throw Error("Admission lease expired; retry request"); return latest;}
      });
    } finally {
      try {
        const current = await this.nc.get(lockId);
        if (current.lease?.token === token)
          await this.nc.put({ ...current, lease: { ...current.lease, until: 0 } }, current.etag);
      } catch {
        // The short lease is deliberately recoverable if release is lost.
      }
    }
  }

  async serializeAdmission(conversationId, fn) {
    const prior=this.admissionJobs.get(conversationId) || Promise.resolve();
    const job=prior.catch(()=>{}).then(fn);
    this.admissionJobs.set(conversationId,job);
    try{return await job;}finally{if(this.admissionJobs.get(conversationId)===job)this.admissionJobs.delete(conversationId);}
  }

  async admit({ conversationId, requestId, text, model, images = [] }) {
    if (
      typeof conversationId !== "string" ||
      !conversationId ||
      typeof requestId !== "string" ||
      !requestId ||
      requestId.length > 200 ||
      typeof text !== "string" ||
      !text.trim() ||
      !Array.isArray(images)
    )
      throw Error("Valid conversation, request ID and text required");
    const requestHash = digest(JSON.stringify([text, model, images]));
    return this.serializeAdmission(conversationId, () => this.withConversationAdmissionLock(conversationId, async (admission) => {
      const slot = await admission.assertCurrent();
      if (slot.reservedGoal) {
        const reserved = await this.optional(slot.reservedGoal.id);
        if (!reserved) {
          await admission.assertCurrent();
          try {await this.nc.put(slot.reservedGoal);} catch (error) {if(!conflict(error))throw error;}
        }
      }
      const all = await this.conversationGoals(conversationId);
      const receipts = all.flatMap((goal) => goal.requestReceipts || []);
      const duplicate = receipts.find((receipt) => receipt.requestId === requestId);
      if (duplicate) {
        if (duplicate.requestHash !== requestHash)
          throw Error("Idempotency conflict: request ID already has different content");
        return this.nc.get(duplicate.goalId || all.find((g) => g.requestReceipts?.some((receipt) => receipt.requestId === requestId))?.id);
      }
      // Legacy records may not have requestReceipts. Their requestId is still
      // a durable identity and must participate in duplicate detection.
      const legacy = all.find((goal) => goal.requestId === requestId);
      if (legacy) {
        if (legacy.requestHash !== requestHash)
          throw Error("Idempotency conflict: request ID already has different content");
        return legacy;
      }
      const open = all.filter((goal) => !terminal(goal));
      if (open.length > 1)
        throw Error("Ambiguous conversation: multiple open parent goals require migration");
      const now = new Date(Math.max(Date.now(), this.lastAdmission + 1)).toISOString();
      this.lastAdmission = Date.parse(now);
      const receipt = {
        requestId,
        requestHash,
        goalId: open[0]?.id,
        receivedAt: now,
        revision: (open[0] ? (open[0].revision || 1) : 0) + 1,
      };
      if (open[0]) {
        const goal = open[0];
        receipt.goalId = goal.id;
        const next = {
          ...goal,
          requestId,
          requestHash,
          needsPlanning: true,
          planReady: false,
          lease: null,
          model,
          revision: receipt.revision,
          requestReceipts: [...(goal.requestReceipts || (goal.requestId ? [{requestId:goal.requestId,requestHash:goal.requestHash,goalId:goal.id,revision:goal.revision||1}] : [])), receipt],
          requestHistory: [
            ...(goal.requestHistory || [{ requestId: goal.requestId, requestHash: goal.requestHash, text: goal.request, revision: 1 }]),
            { requestId, requestHash, text, images, revision: receipt.revision, receivedAt: now },
          ],
          execution: { ...(goal.execution || {}), state: goal.paused ? "paused" : "queued", nextRunAt: 0 },
        };
        try {
          await admission.assertCurrent();
          return await this.nc.put(next, goal.etag);
        } catch (error) {
          if (conflict(error)) throw Error("Conversation changed during admission; retry request");
          throw error;
        }
      }
      const id = crypto.randomUUID();
      receipt.goalId = id;
      const newGoal = {
        id,
        kind: "goal",
        conversationId,
        requestId,
        requestHash,
        requestReceipts: [receipt],
        requestHistory: [{ requestId, requestHash, text, images, revision: 1, receivedAt: now }],
        revision: 1,
        needsPlanning: true,
        title: text.slice(0, 150),
        request: text,
        model,
        status: "NEEDS-ACTION",
        created: now,
        execution: { state: "queued", nextRunAt: 0, lastRunAt: 0 },
      };
      // Persist the creation reservation before the parent: crash recovery or an
      // expired admission holder can only create this same reserved identity.
      const reservation = await admission.assertCurrent();
      await this.nc.put({...reservation, reservedGoal: newGoal}, reservation.etag);
      await admission.assertCurrent();
      return this.nc.put(newGoal);
    }));
  }

  async claim(now = Date.now(), conversationIds) {
    // One short CAS-guarded dispatcher transaction prevents cross-goal races.
    const lockId = "phunbot-dispatch-lease";
    const oldLock = await this.optional(lockId);
    if (oldLock?.lease?.until > now) return null;
    const token = crypto.randomUUID();
    try {
      await this.nc.put(
        {
          id: lockId,
          kind: "coordination",
          title: "phunbot execution admission lease",
          status: "NEEDS-ACTION",
          lease: { token, owner: this.owner, until: now + 120000 },
        },
        oldLock?.etag,
      );
    } catch (error) {
      if (conflict(error)) return null;
      throw error;
    }
    try {
      const goals = (await this.nc.list()).filter((g) => g.kind === "goal" && !g.parent);
      const ambiguous = new Set(openParentAmbiguities(goals).map(x=>x.conversationId));
      const active = goals.filter((g) => !terminal(g) && g.lease?.until > now);
      if (active.length >= this.maxActive) return null;
      const busyConversations = new Set(active.map((g) => g.conversationId));
      const ready = goals.filter(
        (g) =>
          !terminal(g) &&
          (!g.paused || g.needsPlanning) &&
          (g.execution?.state !== "paused" || g.needsPlanning) &&
          !ambiguous.has(g.conversationId) &&
          g.conversationId &&
          (!conversationIds || conversationIds.has(g.conversationId)) &&
          !busyConversations.has(g.conversationId) &&
          (!g.lease || g.lease.until <= now) &&
          (g.needsPlanning || !g.blocker ||
            (g.blocker.kind === "dependency" &&
              now - Date.parse(g.blocker.lastProbeAt || g.blocker.at) >=
                300000)) &&
          (g.execution?.nextRunAt || 0) <= now,
      );
      ready.sort(
        (a, b) =>
          (a.execution?.lastRunAt || 0) - (b.execution?.lastRunAt || 0) ||
          a.created.localeCompare(b.created) ||
          a.id.localeCompare(b.id),
      );
      const goal = ready[0];
      if (!goal) return null;
      return await this.nc.put(
        {
          ...goal,
          execution: { ...goal.execution, state: "running", lastRunAt: now },
          lease: {
            token: crypto.randomUUID(),
            revision: goal.revision || 1,
            mode: goal.needsPlanning || !goal.planReady ? "planning" : "execution",
            owner: this.owner,
            until: now + this.leaseMs,
          },
        },
        goal.etag,
      );
    } finally {
      const lock = await this.nc.get(lockId);
      if (lock.lease?.token === token)
        await this.nc.put(
          { ...lock, lease: { ...lock.lease, until: 0 } },
          lock.etag,
        );
    }
  }

  async valid(id, token, now = Date.now()) {
    const goal = await this.nc.get(id);
    return (
      !terminal(goal) &&
      ((!goal.paused && goal.execution?.state !== "paused") || goal.lease?.mode === "planning") &&
      (!goal.lease?.revision || goal.lease.revision === (goal.revision || 1)) &&
      goal.lease?.token === token && goal.lease.until > now
    );
  }

  async release(id, token, execution, now = Date.now()) {
    const goal = await this.nc.get(id);
    if (terminal(goal) || goal.lease?.token !== token) return goal;
    if (goal.paused) execution = {state:"paused",nextRunAt:0};
    return this.nc.put(
      {
        ...goal,
        lease: null,
        execution: { ...goal.execution, ...execution, endedAt: now },
      },
      goal.etag,
    );
  }
}
