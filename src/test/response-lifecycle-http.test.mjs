import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { start } from "../app.mjs";
import {GoalQueue} from "../goal-queue.mjs";
import { appendConversationOutput, ensureConversationProjection } from "../conversation-output.mjs";

class Nc {
  data = new Map(); n = 0;
  async get(id) { return structuredClone(this.data.get(id)); }
  async list() { return [...this.data.values()].map(x => structuredClone(x)); }
  async put(value, etag) { const old = this.data.get(value.id); if (old && etag !== old.etag) throw Error("412"); const next = structuredClone({ ...value, etag: String(++this.n) }); this.data.set(value.id, next); return next; }
}
async function fixture({ goal = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-response-http-"));
  fs.mkdirSync(root + "/config", { recursive: true });
  const nc = new Nc();
  const id = "11111111-1111-4111-8111-111111111111";
  const manager = SessionManager.create(root + "/work", root + "/state/pi-sessions");
  const record = { id, title: "Fixture", model: "fixture", sessionFile: manager.sessionFile, execution: "idle" };
  fs.writeFileSync(root + "/state/conversations.json", JSON.stringify([record]));
  if (goal) { const g = { id: "goal-http", kind: "goal", conversationId: id, status: "NEEDS-ACTION", revision: 1, planReady: true, execution: { state: "queued", nextRunAt: 0 } }; await nc.put(g); record.goalId = g.id; record.execution = "running"; fs.writeFileSync(root + "/state/conversations.json", JSON.stringify([record])); }
  const server = await start({ root, ncClient: nc, token: "fixture", port: 0, sessionFactory: async () => ({ sessionManager: manager, session: { sessionManager: manager, abort: async () => {}, dispose() {} } }) });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (url, body) => { const r = await fetch(base + "/api/" + url, { method: body ? "POST" : "GET", headers: { Authorization: "Bearer fixture", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json() }; };
  return { root, nc, id, manager, server, api };
}

test("HTTP verified answer is trusted visible once, raw debug stays private, and read receipt uses custom identity", async () => {
  const f = await fixture();
  try {
    ensureConversationProjection(f.manager);
    f.manager.appendMessage({ role: "assistant", timestamp: Date.now(), content: [{ type: "text", text: "internal raw debug" }] });
    const published = appendConversationOutput(f.manager, "answer", "Verified answer");
    const messages = await f.api(`sessions/${f.id}/messages`);
    assert.equal(messages.status, 200);
    assert.equal(messages.data.messages.filter(m => m.role === "assistant").length, 1);
    assert.match(JSON.stringify(messages.data.messages), /Verified answer/);
    assert.doesNotMatch(JSON.stringify(messages.data.messages), /internal raw debug/);
    assert.ok(messages.data.lastResponseId);
    const responseId = messages.data.lastResponseId;
    assert.equal((await f.api(`sessions/${f.id}/read`, { responseId })).status, 200);
    assert.equal((await f.api("sessions")).data[0].unread, false);
    assert.equal((await f.api(`sessions/${f.id}/read`, { responseId: "stale" })).status, 409);
  } finally { await new Promise(r => f.server.close(r)); fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("direct HTTP lifecycle cannot bypass an ongoing conversation admission",async()=>{
 const f=await fixture({goal:true});
 try {await new GoalQueue(f.nc).withConversationAdmissionLock(f.id,async()=>{
  const result=await f.api(`sessions/${f.id}/pause`,{goalId:"goal-http"});
  assert.notEqual(result.status,200);
  assert.equal((await f.nc.get("goal-http")).revision,1);
 });}finally{await new Promise(r=>f.server.close(r));fs.rmSync(f.root,{recursive:true,force:true});}
});

test("HTTP pause fences a goal and aborts the controlled runtime seam", async () => {
  const f = await fixture({ goal: true });
  try {
    const result = await f.api(`sessions/${f.id}/pause`, { goalId: "goal-http" });
    assert.equal(result.status, 200);
    assert.equal(result.data.goal.paused, true);
    assert.equal((await f.api("goals")).data.find(g => g.id === "goal-http").revision, 2);
  } finally { await new Promise(r => f.server.close(r)); fs.rmSync(f.root, { recursive: true, force: true }); }
});
