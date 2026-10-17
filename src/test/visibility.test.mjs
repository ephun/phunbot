import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  appendConversationOutput,
  conversationOutput,
  conversationVisibility,
  conversationAudit,
  ensureConversationProjection,
} from "../conversation-output.mjs";
import { conversationMessages, appendCanonicalUserTurn } from "../transcript.mjs";

test("trusted output records carry an assistant role and explicit user-facing kind", () => {
  const record = conversationOutput("answer", "A useful answer");
  assert.deepEqual(record, {
    role: "assistant",
    kind: "answer",
    content: "A useful answer",
  });
});

test("empty output is rejected and cannot create a copy orphan", () => {
  const manager = SessionManager.inMemory();
  assert.throws(() => appendConversationOutput(manager, "answer", "  "), /non-empty/);
  assert.equal(manager.getBranch().length, 0);
});

test("only trusted explicit records and completed non-tool answers are visible", () => {
  const manager = SessionManager.inMemory();
  manager.appendMessage({ role: "user", content: "Do it", timestamp: 1 });
  manager.appendMessage({
    role: "assistant", timestamp: 2, stopReason: "stop",
    content: [{ type: "text", text: "Old answer" }],
  });
  manager.appendMessage({
    role: "assistant", timestamp: 3, stopReason: "toolUse",
    content: [{ type: "text", text: "debug dump" }, { type: "toolCall", id: "x", name: "read", arguments: {} }],
  });
  manager.appendMessage({
    role: "toolResult", timestamp: 4, toolName: "read", toolCallId: "x",
    content: [{ type: "text", text: "secret tool output" }],
  });
  manager.appendCustomMessageEntry("memory-retrieval", "private custom", true);
  appendConversationOutput(manager, "progress", "Still working");
  const visible = conversationVisibility({ sessionManager: manager });
  assert.deepEqual(visible.map((x) => x.content), ["Do it", "Still working"]);
  assert.ok(!JSON.stringify(visible).includes("debug dump"));
  assert.ok(!JSON.stringify(visible).includes("secret tool output"));
  assert.ok(!JSON.stringify(visible).includes("private custom"));
  assert.equal(manager.getBranch().filter((x) => x.type === "message").length, 4);
});

test("a useful answer can be published with a bounded verifier issue, while native output stays held", () => {
  const manager = SessionManager.inMemory();
  appendConversationOutput(manager, "answer", "The artifact is ready", { verifierIssue: "Verification unavailable" });
  const visible = conversationVisibility({ sessionManager: manager });
  assert.equal(visible.length, 1);
  assert.equal(visible[0].content, "The artifact is ready");
  assert.equal(visible[0].details.verifierIssue, "Verification unavailable");
});

test("audit projection retains internal executor records separately", () => {
  const manager = SessionManager.inMemory();
  manager.appendMessage({ role: "assistant", timestamp: 1, content: [{ type: "thinking", thinking: "private" }, { type: "toolCall", id: "x", name: "read", arguments: { path: "/tmp" } }] });
  manager.appendMessage({ role: "toolResult", timestamp: 2, toolName: "read", toolCallId: "x", content: [{ type: "text", text: "result" }] });
  assert.equal(conversationVisibility({ sessionManager: manager }).length, 0);
  assert.equal(conversationAudit({ sessionManager: manager }).length, 2);
});

test("conversationMessages uses the explicit visibility projection", () => {
  const manager = SessionManager.inMemory();
  manager.appendCustomMessageEntry("goal-controller", "Acceptance progress", true);
  assert.deepEqual(conversationMessages({ sessionManager: manager }), []);
});

test("projection marker preserves only a safe historical answer and suppresses later native text", () => {
  const manager = SessionManager.inMemory();
  manager.appendMessage({ role: "assistant", timestamp: 1, stopReason: "stop", content: [{ type: "text", text: "historical" }] });
  ensureConversationProjection(manager);
  manager.appendMessage({role:"user",content:"Follow-up",timestamp:2});
  manager.appendMessage({ role: "assistant", timestamp: 2, stopReason: "toolUse", content: [{ type: "text", text: "private churn" }, { type: "toolCall", id: "x", name: "read", arguments: {} }] });
  manager.appendMessage({ role: "assistant", timestamp: 3, stopReason: "stop", content: [{ type: "text", text: "raw final" }] });
  appendConversationOutput(manager, "answer", "trusted final");
  assert.deepEqual(conversationVisibility({ sessionManager: manager }).map((m) => m.content), [[{ type: "text", text: "historical" }], "Follow-up", "trusted final"]);
});

test("canonical control user turns are durable and idempotent", () => {
  const manager = SessionManager.inMemory();
  assert.equal(appendCanonicalUserTurn(manager, "yes", { requestId: "r1", goalId: "g" }), true);
  assert.equal(appendCanonicalUserTurn(manager, "yes", { requestId: "r1", goalId: "g" }), false);
  const turns = manager.getBranch().filter((entry) => entry.type === "message");
  assert.equal(turns.length, 1);
  assert.equal(turns[0].message.phunbotRequestId, "r1");
  assert.equal(turns[0].message.content[0].text, "yes");
});
