import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { start } from "../app.mjs";

test("legacy authorization HTTP action is retained but routes decisions to chat", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-control-http-"));
  const conversationId = "11111111-1111-4111-8111-111111111111";
  const goal = { id: "goal-http", kind: "goal", conversationId, status: "NEEDS-ACTION", revision: 1, authorizations: [{ id: "pending-http", state: "pending", goalRevision: 1, conversationId }], execution: {} };
  let current = structuredClone(goal);
  const nc = { get: async id => id === current.id ? structuredClone(current) : null, list: async () => [structuredClone(current)], put: async next => { current = structuredClone(next); return structuredClone(current); } };
  fs.mkdirSync(root + "/state", { recursive: true });
  fs.writeFileSync(root + "/state/conversations.json", JSON.stringify([{ id: conversationId, title: "Control", model: "fixture", goalId: goal.id, execution: "waiting_permission" }]));
  const app = await start({ root, token: "fixture", port: 0, ncClient: nc });
  try {
    const response = await fetch(`http://127.0.0.1:${app.address().port}/api/sessions/${conversationId}/authorizations`, {
      method: "POST", headers: { Authorization: "Bearer fixture", "Content-Type": "application/json" },
      body: JSON.stringify({ goalId: goal.id, requestId: "pending-http", approve: true }),
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /authenticated conversation/i);
    assert.equal(current.authorizations[0].state, "pending");
  } finally { await new Promise(resolve => app.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); }
});
