import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { conversationMessages } from "../transcript.mjs";
import { requestDelivered } from "../transcript.mjs";
test("request delivery is recovered from canonical Pi history, never guessed from a checkpoint flag", () => {
  const manager = SessionManager.inMemory();
  manager.appendCustomMessageEntry(
    "goal-context",
    "Active goal first. Continue.",
    false,
  );
  assert.equal(requestDelivered(manager, "first", "Original request"), false);
  manager.appendMessage({
    role: "user",
    content: "Original request",
    timestamp: 1,
  });
  assert.equal(requestDelivered(manager, "first", "Original request"), true);
  manager.appendCustomMessageEntry(
    "goal-context",
    "Active goal second. Continue.",
    false,
  );
  assert.equal(requestDelivered(manager, "second", "Original request"), false);
  manager.appendCompaction("Summary", null, 1000);
  assert.equal(requestDelivered(manager, "first", "Original request"), true);
});
test("response evidence captures actual visible output, never reasoning or old turns", async () => {
  const m = await import("../transcript.mjs");
  assert.equal(typeof m.responseEvidence, "function");
  const msg = {
    role: "assistant",
    timestamp: 20,
    content: [
      { type: "thinking", thinking: "private reasoning" },
      { type: "text", text: "EARLY_STOP" },
    ],
  };
  assert.equal(m.responseEvidence(msg, 10).text, "EARLY_STOP");
  assert.equal(m.responseEvidence(msg, 30), null);
  assert.equal(m.responseEvidence({ ...msg, role: "user" }, 10), null);
  assert.equal(
    m.responseEvidence(
      { ...msg, content: [{ type: "thinking", thinking: "private" }] },
      10,
    ),
    null,
  );
});
test("browser transcript uses native Pi history rather than the compacted model context", () => {
  const manager = SessionManager.inMemory();
  manager.appendMessage({
    role: "user",
    content: "Original user request",
    timestamp: 1,
  });
  manager.appendCustomMessageEntry(
    "memory-retrieval",
    "Internal working memory",
    false,
  );
  manager.appendCompaction("A short summary", null, 1000);
  const history = conversationMessages({
    sessionManager: manager,
    messages: [],
  });
  assert.equal(history.length, 1);
  assert.equal(history[0].content, "Original user request");
});

test("browser projection excludes provider reasoning and redacts trace credentials without altering canonical history", () => {
  const manager = SessionManager.inMemory();
  manager.appendMessage({
    role: "assistant",
    timestamp: 1,
    content: [
      { type: "thinking", thinking: "PRIVATE_REASONING" },
      { type: "text", text: "Visible answer" },
      {
        type: "toolCall",
        id: "tool-one",
        name: "read",
        arguments: { path: "/work/artifact", password: "synthetic-secret" },
      },
    ],
  });
  manager.appendMessage({
    role: "toolResult",
    timestamp: 2,
    toolName: "read",
    toolCallId: "tool-one",
    content: [{ type: "text", text: "Bearer " + "x".repeat(30) }],
    isError: false,
  });
  manager.appendCustomMessageEntry(
    "goal-controller",
    "Inspectable acceptance progress",
    true,
  );
  const projected = conversationMessages({ sessionManager: manager });
  assert.ok(!JSON.stringify(projected).includes("PRIVATE_REASONING"));
  assert.ok(!JSON.stringify(projected).includes("synthetic-secret"));
  assert.ok(!JSON.stringify(projected).includes("x".repeat(30)));
  assert.ok(
    JSON.stringify(projected).includes("Inspectable acceptance progress"),
  );
  assert.ok(JSON.stringify(manager.getBranch()).includes("PRIVATE_REASONING"));
});
