import { test } from "node:test";
import assert from "node:assert/strict";
import { projectConversation, executionLabel } from "../presentation.mjs";

test("presentation separates native conversation from internal traces without exposing thinking", () => {
  const result = projectConversation([
    {
      role: "user",
      timestamp: 1,
      content: [
        { type: "text", text: "A question" },
        { type: "image", mimeType: "image/png", data: "fixture" },
      ],
    },
    {
      role: "assistant",
      timestamp: 2,
      content: [
        { type: "thinking", thinking: "PRIVATE" },
        { type: "text", text: "An answer" },
        {
          type: "toolCall",
          id: "one",
          name: "read",
          arguments: { path: "artifact" },
        },
      ],
    },
    {
      role: "toolResult",
      toolName: "read",
      content: [{ type: "text", text: "readback" }],
    },
    {
      role: "custom",
      customType: "goal-controller",
      content: "internal state",
    },
  ]);
  assert.deepEqual(
    result.messages.map((m) => m.text),
    ["A question", "An answer"],
  );
  assert.equal(result.messages[0].images.length, 1);
  assert.equal(result.traces.length, 3);
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  assert.equal(
    result.messages[1].key,
    projectConversation([
      { role: "user", timestamp: 1, content: "A question" },
      {
        role: "assistant",
        timestamp: 2,
        content: [{ type: "text", text: "An answer" }],
      },
    ]).messages[1].key,
  );
});
test("execution state labels distinguish queued, blocked, failure and verified completion", () => {
  assert.equal(executionLabel("queued"), "Queued");
  assert.equal(executionLabel("waiting_capacity"), "Waiting for capacity");
  assert.equal(executionLabel("transient_failure"), "Retry scheduled");
  assert.equal(executionLabel("verified_complete"), "Verified complete");
  assert.equal(executionLabel("blocked"), "Blocked");
  assert.equal(executionLabel("cancelled"), "Cancelled");
});
