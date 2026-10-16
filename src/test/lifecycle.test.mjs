import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Controller } from "../controller.mjs";

test("a low-risk question completes from real native answer without artificial tool evidence", async () => {
  const { controller: c, nc } = setup();
  const goal = await c.create("What is recursion?", "session", "model");
  await c.plan(goal.id, [
    { title: "Answer the question", verifier: { kind: "answer_quality" } },
  ]);
  c.record(
    goal.id,
    "assistant_output",
    {},
    {
      source:
        "Actual Pi assistant output; not independent proof of external state",
      text: "Recursion means solving a problem by applying the same function to smaller inputs until a base case is reached.",
      final: true,
    },
  );
  assert.equal((await c.settle(goal.id)).reason, "verified_complete");
  assert.equal((await nc.get(goal.id)).status, "COMPLETED");
});

test("answer verification cannot self-certify infrastructure changes", async () => {
  const { controller: c } = setup();
  const goal = await c.create("Restart the server", "session", "model");
  await assert.rejects(
    () =>
      c.plan(goal.id, [
        { title: "Done", verifier: { kind: "answer_quality" } },
      ]),
    /answer|contract|evidence/i,
  );
});

test("repeated empty or identical slices trigger diagnosis and cooldown instead of a tight loop", async () => {
  const { controller: c } = setup();
  const goal = await c.create("Make progress", "session", "model");
  for (let i = 0; i < 3; i++) {
    c.beginSlice(goal.id, 1000);
    c.yieldSlice(goal.id, "slice_budget", 1010);
  }
  const cp = c.checkpoint(goal.id);
  assert.equal(cp.state, "ineffective_strategy");
  assert.ok(cp.nextRunAt > 1010);
  assert.match(cp.recoveryInstruction, /Diagnose|different/);
});

test("a delayed verification cannot commit after its execution lease is revoked", async () => {
  const { controller: c, nc } = setup();
  const g = await c.create("Observe external status", "session", "model");
  const [t] = await c.plan(g.id, [
    { title: "Readback", verifier: { kind: "evidence_review" } },
  ]);
  const event = c.record(g.id, "actual_read", {}, { value: "ready" });
  let valid = true;
  c.executionGuard = async () => {
    if (!valid) throw Error("Lease revoked");
  };
  await assert.rejects(
    () =>
      c.verify(g.id, t.id, async () => {
        valid = false;
        return { pass: true, reason: "Readback", evidenceIds: [event.id] };
      }),
    /revoked/,
  );
  assert.equal((await nc.get(t.id)).status, "NEEDS-ACTION");
});

test("a lease takeover during criterion persistence cannot publish accepted verification", async () => {
  const { controller: c, nc } = setup();
  const g = await c.create("Observe external state", "session", "model");
  const [t] = await c.plan(g.id, [
    { title: "Fresh readback", verifier: { kind: "evidence_review" } },
  ]);
  const event = c.record(g.id, "actual_read", {}, { state: "ready" });
  const put = nc.put.bind(nc);
  nc.put = async (data, etag) => {
    const current = await nc.get(data.id);
    if (current && current.etag !== etag) throw Error("Nextcloud 412");
    const result = await put(data, etag);
    if (data.kind === "criterion" && data.evidence) {
      const parent = await nc.get(g.id);
      await put({
        ...parent,
        lease: { token: "new-owner", until: Date.now() + 10000 },
      });
    }
    return result;
  };
  // Simulate a takeover after the final pre-write guard has returned.
  c.executionGuard = async () => {};
  await assert.rejects(
    () =>
      c.verify(g.id, t.id, async () => ({
        pass: true,
        reason: "Fresh readback",
        evidenceIds: [event.id],
      })),
    /412|stale|lease/i,
  );
  assert.equal((await nc.get(t.id)).status, "NEEDS-ACTION");
  assert.equal((await nc.get(g.id)).status, "NEEDS-ACTION");
});

test("the authoritative parent acceptance CAS is the final verification write", async () => {
  const { controller: c, nc } = setup();
  const g = await c.create("Observe external state", "session", "model");
  const [t] = await c.plan(g.id, [
    { title: "Readback", verifier: { kind: "evidence_review" } },
  ]);
  const event = c.record(g.id, "actual_read", {}, { state: "ready" });
  const writes = [];
  const put = nc.put.bind(nc);
  nc.put = async (...args) => {
    writes.push(args[0]);
    return put(...args);
  };
  await c.verify(g.id, t.id, async () => ({
    pass: true,
    reason: "Fresh readback",
    evidenceIds: [event.id],
  }));
  assert.equal(writes.at(-1).id, g.id);
  assert.equal(
    writes.at(-1).verificationReceipts[t.id],
    writes.find((x) => x.id === t.id).evidence.verificationId,
  );
});

test("takeover or cancellation after final receipt acceptance permits no later child mutation", async () => {
  for (const cancel of [false, true]) {
    const { controller: c, nc } = setup();
    const g = await c.create("Observe external state", "session", "model");
    const [t] = await c.plan(g.id, [
      { title: "Readback", verifier: { kind: "evidence_review" } },
    ]);
    const event = c.record(g.id, "actual_read", {}, { state: "ready" });
    const put = nc.put.bind(nc);
    nc.put = async (...args) => {
      const value = await put(...args);
      if (args[0].id === g.id && args[0].verificationReceipts) {
        await put({
          ...value,
          ...(cancel
            ? { status: "CANCELLED" }
            : { lease: { token: "new-owner", until: Date.now() + 10000 } }),
        });
      }
      return value;
    };
    await assert.rejects(
      () =>
        c.verify(g.id, t.id, async () => ({
          pass: true,
          reason: "Readback",
          evidenceIds: [event.id],
        })),
      /lease|terminal|stale/i,
    );
    assert.equal((await nc.get(t.id)).status, "COMPLETED");
    assert.equal(
      (await nc.get(g.id)).status,
      cancel ? "CANCELLED" : "NEEDS-ACTION",
    );
  }
});

test("settlement rejects a completed criterion whose verification receipt was never accepted", async () => {
  const { controller: c, nc } = setup();
  const g = await c.create("Observe external state", "session", "model");
  const [t] = await c.plan(g.id, [
    { title: "Readback", verifier: { kind: "evidence_review" } },
  ]);
  await nc.put({
    ...t,
    status: "COMPLETED",
    evidence: {
      kind: "evidence_review",
      verifiedAt: new Date().toISOString(),
      verificationId: "stale-verifier",
    },
  });
  const decision = await c.settle(g.id);
  assert.notEqual(decision.reason, "verified_complete");
  assert.ok(decision.remaining.some((criterion) => criterion.id === t.id));
  assert.equal((await nc.get(g.id)).status, "NEEDS-ACTION");
});

test("planning stops child writes on lease loss and resumes the exact partial plan safely", async () => {
  const { controller: c, nc } = setup();
  const g = await c.create("Create two artifacts", "session", "model");
  const criteria = [
    {
      title: "First artifact",
      verifier: { kind: "file_contains", path: "one", text: "ONE" },
    },
    {
      title: "Second artifact",
      verifier: { kind: "file_contains", path: "two", text: "TWO" },
    },
  ];
  let valid = true;
  c.executionGuard = async () => {
    if (!valid) throw Error("Lease revoked");
  };
  const put = nc.put.bind(nc);
  nc.put = async (...args) => {
    const result = await put(...args);
    if (args[0].kind === "criterion") valid = false;
    return result;
  };
  await assert.rejects(() => c.plan(g.id, criteria), /revoked/);
  assert.equal((await nc.list()).filter((t) => t.parent === g.id).length, 1);
  assert.equal((await nc.get(g.id)).planReady, false, 'A partial plan must remain eligible for deep planning after restart');
  const planned = (await nc.get(g.id)).expectedChildIds;
  valid = true;
  nc.put = put;
  assert.deepEqual(
    (await c.plan(g.id, criteria)).map((t) => t.id),
    planned,
  );
  assert.equal((await nc.list()).filter((t) => t.parent === g.id).length, 2);
  assert.equal((await nc.get(g.id)).planReady,true);
});

test('plan publication rejects missing or replaced children and intervening terminal/revision changes',async()=>{
 for(const sabotage of ['missing','replaced','terminal','revision']) {
  const {controller:c,nc}=setup();const g=await c.create('Inspect actual state','session','model');const put=nc.put.bind(nc);
  nc.put=async(data,...args)=>{const value=await put(data,...args);if(data.kind==='criterion'){
    if(sabotage==='missing')nc.data.delete(data.id);
    if(sabotage==='replaced')nc.data.set(data.id,{...value,title:'Different criterion'});
    if(sabotage==='terminal'||sabotage==='revision'){const parent=await nc.get(g.id);await put({...parent,...(sabotage==='terminal'?{status:'CANCELLED'}:{revision:(parent.revision||1)+1})});}
   }return value;};
  await assert.rejects(()=>c.plan(g.id,[{title:'Actual readback',verifier:{kind:'evidence_review'}}]),/incomplete|changed|superseded/);
  assert.equal((await nc.get(g.id)).planReady,false,sabotage);
 }
});

test('plan publication rejects a parent ETag changed after staging', async () => {
  const {controller:c,nc}=setup();
  const g=await c.create('Create an artifact','session','model');
  const put=nc.put.bind(nc);
  nc.put=async (...args)=>{
    const result=await put(...args);
    if(args[0].kind==='criterion') {
      const parent=await nc.get(g.id);
      await put({...parent,blocker:{kind:'authorization',reason:'Concurrent owner boundary'}},parent.etag);
    }
    return result;
  };
  await assert.rejects(()=>c.plan(g.id,[{title:'Artifact',verifier:{kind:'file_contains',path:'one',text:'ONE'}}]),/parent version|superseded/i);
  assert.equal((await nc.get(g.id)).planReady,false);
});

class Tasks {
  data = new Map();
  async get(id) {
    return structuredClone(this.data.get(id));
  }
  async put(data) {
    const value = structuredClone({ ...data, etag: crypto.randomUUID() });
    this.data.set(data.id, value);
    return value;
  }
  async list() {
    return [...this.data.values()].map((value) => structuredClone(value));
  }
}
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-lifecycle-"));
  const nc = new Tasks();
  return {
    root,
    nc,
    controller: new Controller(root, nc, {
      turns: 2,
      maxModelTurns: 2,
      sliceMs: 10,
      maxRetries: 3,
    }),
  };
}

test("productive normal yields preserve evidence, criteria, identity and do not consume failure attempts", async () => {
  const { controller: c, root, nc } = setup();
  const goal = await c.create(
    "Produce the artifact after five slices",
    "session",
    "model",
  );
  const [criterion] = await c.plan(goal.id, [
    {
      title: "File exists",
      verifier: { kind: "file_contains", path: "result", text: "DONE" },
    },
  ]);
  for (let i = 0; i < 5; i++) {
    c.beginSlice(goal.id);
    c.record(goal.id, "progress", { step: i }, { actual: i });
    c.yieldSlice(goal.id, "slice_budget");
    assert.equal(c.checkpoint(goal.id).retries || 0, 0);
    assert.equal((await c.settle(goal.id)).continue, true);
  }
  const cp = c.checkpoint(goal.id);
  assert.equal(cp.slices, 5);
  assert.equal(new Set(cp.attempts.map((a) => a.id)).size, 5);
  assert.equal(cp.evidence.length, 5);
  assert.equal((await nc.get(goal.id)).expectedChildIds[0], criterion.id);
  fs.mkdirSync(root + "/work");
  fs.writeFileSync(root + "/work/result", "DONE");
  await c.verify(goal.id, criterion.id);
  assert.equal((await c.settle(goal.id)).reason, "verified_complete");
});

test("legacy cumulative limits and exhausted retries never abandon an unfinished goal", async () => {
  const { controller: c, nc, root } = setup();
  const goal = await c.create("Long task", "session", "model");
  c.save({
    ...c.checkpoint(goal.id),
    started: Date.now() - 86400000,
    paused: "resource_limit",
    retries: 30,
    turns: 1000,
    modelTurns: 1000,
  });
  const restored = new Controller(root, nc, c.limits);
  restored.beginSlice(goal.id);
  assert.equal((await restored.settle(goal.id)).continue, true);
  assert.equal((await nc.get(goal.id)).status, "NEEDS-ACTION");
  assert.equal(restored.checkpoint(goal.id).paused, undefined);
});

test("provider attempts back off, change recovery strategy and remain eligible after cooldown", async () => {
  const { controller: c } = setup();
  const goal = await c.create("Recover provider", "session", "model");
  for (let i = 0; i < 7; i++)
    c.deferFailure(goal.id, "Provider HTTP 503", 1000);
  const cp = c.checkpoint(goal.id);
  assert.equal(cp.state, "transient_failure");
  assert.ok(cp.nextRunAt > 1000);
  assert.ok(cp.strategyGeneration >= 2);
  assert.ok(cp.strategyAttempts < 3);
  assert.equal(cp.paused, undefined);
  assert.equal(c.eligible(goal.id, 1000), false);
  assert.equal(c.eligible(goal.id, cp.nextRunAt + 1), true);
});

test("model turn and controller turn budgets yield rather than permanently pause", async () => {
  const { controller: c } = setup();
  const g = await c.create("Bounded work", "session", "model");
  c.beginSlice(g.id);
  const cp = c.checkpoint(g.id);
  cp.modelTurns = 2;
  c.save(cp);
  const result = await c.settle(g.id);
  assert.equal(result.reason, "yielded");
  assert.equal(result.continue, false);
  assert.equal(c.eligible(g.id), true);
});
