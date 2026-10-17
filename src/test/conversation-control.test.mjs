import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConversationControl, parseConversationTurn } from "../conversation-control.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-control-"));
  let goal = { id: "g", kind: "goal", conversationId: "c", status: "NEEDS-ACTION", revision: 3, paused: false, execution: { state: "running" }, authorizations: [] };
  const extras=new Map();let n=0;const nc={async list(){return [goal,...extras.values()].map(x=>structuredClone(x))},async get(id){if(id==="g")return structuredClone(goal);if(!extras.has(id))throw Error("404");return structuredClone(extras.get(id))},async put(next,etag){const old=next.id==="g"?goal:extras.get(next.id);if(old&&old.etag!==etag)throw Error("412");const v=structuredClone({...next,etag:String(++n)});if(v.id==="g")goal=v;else extras.set(v.id,v);return structuredClone(v)}};
  return { root, nc, get: () => goal, control: new ConversationControl({ root, nc, lifecycle: async (id, action) => { goal = { ...goal, paused: action === "pause", status: action === "cancel" ? "CANCELLED" : action === "complete" ? "COMPLETED" : goal.status, execution: { ...goal.execution, state: action === "pause" ? "paused" : action } }; return structuredClone(goal); } }) };
}

test("parses only ordinary exact lifecycle controls", () => {
  assert.deepEqual(parseConversationTurn("Pause"), { kind: "lifecycle", action: "pause" });
  assert.deepEqual(parseConversationTurn("Continue"), { kind: "lifecycle", action: "resume" });
  assert.deepEqual(parseConversationTurn("Resume"), { kind: "lifecycle", action: "resume" });
  assert.deepEqual(parseConversationTurn("Cancel this"), { kind: "lifecycle", action: "cancel" });
  assert.deepEqual(parseConversationTurn("We're done"), { kind: "lifecycle", action: "complete" });
  assert.equal(parseConversationTurn("please pause"), null);
});

test("lifecycle receipt is durable and replayable without changing revision", async () => {
  const f = fixture();
  const first = await f.control.handle({ goalId: "g", conversationId: "c", requestId: "turn-1", text: "Pause", authenticated: true, principal: "authenticated-owner" });
  const second = await f.control.handle({ goalId: "g", conversationId: "c", requestId: "turn-1", text: "Pause", authenticated: true, principal: "authenticated-owner" });
  assert.equal(first.goal.revision, 3); assert.equal(second.replayed, true); assert.equal(f.get().revision, 3);
  const afterRestart = new ConversationControl({ root: f.root, nc: f.nc, lifecycle: async () => f.get() });
  assert.equal((await afterRestart.handle({ goalId: "g", conversationId: "c", requestId: "turn-1", text: "Pause", authenticated: true, principal: "authenticated-owner" })).replayed, true);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test("multiple pending approvals require explicit pending id", async () => {
  const f = fixture();
  f.get().authorizations = [{ id: "p1", state: "pending", goalRevision: 3, conversationId: "c" }, { id: "p2", state: "pending", goalRevision: 3, conversationId: "c" }];
  const result = await f.control.handle({ goalId: "g", conversationId: "c", requestId: "turn-2", text: "Yes", authenticated: true, principal: "authenticated-owner" });
  assert.equal(result.kind, "question"); assert.match(result.content, /p1/); assert.match(result.content, /p2/);
});
