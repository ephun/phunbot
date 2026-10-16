import { test } from "node:test";
import assert from "node:assert/strict";
import { GoalQueue, dryRunGoalMigration } from "../goal-queue.mjs";
import { Controller } from "../controller.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

class Tasks {
  constructor() { this.data = new Map(); this.etag = 0; }
  async get(id) { if (!this.data.has(id)) throw Error("404"); return structuredClone(this.data.get(id)); }
  async list() { return [...this.data.values()].map((value) => structuredClone(value)); }
  async put(value, etag) {
    const prior = this.data.get(value.id);
    if ((prior && prior.etag !== etag) || (!prior && etag)) throw Error("412");
    const next = structuredClone({ ...value, etag: String(++this.etag) });
    this.data.set(next.id, next); return structuredClone(next);
  }
}
const root = () => fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-pr4-"));

test("open parent admission retains one goal identity and terminal followup starts a new parent", async () => {
  const nc = new Tasks(); const q = new GoalQueue(nc);
  const first = await q.admit({ conversationId: "c", requestId: "r1", text: "first", model: "fast" });
  const second = await q.admit({ conversationId: "c", requestId: "r2", text: "followup", model: "fast" });
  assert.equal(second.id, first.id);
  assert.equal((await nc.get(first.id)).revision, 2);
  await nc.put({ ...(await nc.get(first.id)), status: "CANCELLED" }, (await nc.get(first.id)).etag);
  const next = await q.admit({ conversationId: "c", requestId: "r3", text: "new work", model: "fast" });
  assert.notEqual(next.id, first.id);
});

test("paused open parent remains occupied and incidental admission does not resume it", async () => {
  const nc = new Tasks(); const q = new GoalQueue(nc);
  const g = await q.admit({ conversationId: "c", requestId: "r1", text: "work", model: "fast" });
  await nc.put({ ...(await nc.get(g.id)), paused: true, execution: { state: "paused" } }, (await nc.get(g.id)).etag);
  const followup = await q.admit({ conversationId: "c", requestId: "r2", text: "incidental", model: "fast" });
  assert.equal(followup.id, g.id);
  assert.equal((await nc.get(g.id)).paused, true);
  const claim = await q.claim(Date.now());
  assert.equal(claim.id, g.id);
  assert.equal(claim.paused, true);
  assert.equal(claim.lease.mode, "planning"); // New instruction is interpreted without resuming execution.
});

test("migration dry run reports ambiguity without writing or selecting a parent", () => {
  const rows = [
    { id: "a", kind: "goal", conversationId: "c", status: "NEEDS-ACTION" },
    { id: "b", kind: "goal", conversationId: "c", status: "NEEDS-ACTION" },
    { id: "done", kind: "goal", conversationId: "c", status: "COMPLETED" },
  ];
  assert.deepEqual(dryRunGoalMigration(rows), {
    mode: "dry-run", writes: 0, conversations: 1,
    ambiguities: [{ conversationId: "c", goalIds: ["a", "b"] }], safe: false,
  });
});

test("controller pause, explicit resume, manual completion preserve evidence and completion kind", async () => {
  const nc = new Tasks(); const c = new Controller(root(), nc);
  const g = await c.create("work", "session", "fast");
  const evidence = c.record(g.id, "read", {}, { ok: true });
  await c.pause(g.id);
  assert.equal((await nc.get(g.id)).execution.state, "paused");
  await c.resumeGoal(g.id);
  assert.equal((await nc.get(g.id)).paused, false);
  await c.complete(g.id);
  const done = await nc.get(g.id);
  assert.equal(done.status, "COMPLETED");
  assert.equal(done.completionKind, "user-directed");
  assert.equal(c.checkpoint(g.id).evidence[0].id, evidence.id);
});
