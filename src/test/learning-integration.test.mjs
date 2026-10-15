import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Memory } from "../memory.mjs";
import { Index } from "../index.mjs";
import { runMemoryReview } from "../memory-review.mjs";

test("normal maintenance learns selectively from canonical Pi history and checkpoints its review", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "phunbot-learning-integration-"),
  );
  fs.mkdirSync(root + "/work");
  const manager = SessionManager.create(
    root + "/work",
    root + "/state/pi-sessions",
  );
  const sourceId = manager.appendMessage({
    role: "user",
    timestamp: 1000,
    content: [
      {
        type: "text",
        text: "For future maintenance, I prefer targeted rollback copies instead of full backups for small changes.",
      },
    ],
  });
  manager.appendMessage({
    role: "assistant",
    timestamp: 2000,
    content: [{ type: "text", text: "Understood." }],
    api: "test",
    provider: "fixture",
    model: "fixture",
    usage: {
      input: 0,
      output: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, total: 0 },
    },
    stopReason: "stop",
  });
  const memory = new Memory(root);
  const index = new Index(root, memory, async (texts) =>
    texts.map(() => [1, 0]),
  );
  let calls = 0;
  const runtime = {
    getModel: () => ({ id: "fixture" }),
    completeSimple: async () => {
      calls++;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              observations: [
                {
                  id: "rollback-preference",
                  title: "Rollback preference",
                  body: "The owner prefers targeted rollback copies for small maintenance changes.",
                  sourceIds: [sourceId],
                  durable: true,
                  reason: "Stable owner preference.",
                },
              ],
            }),
          },
        ],
      };
    },
  };
  const policy = {
    provider: "fixture",
    roles: { reviewer: "fixture" },
    maintenance: {
      maxPairsPerRun: 0,
      maxSessionsPerRun: 1,
      reviewTimeoutMs: 1000,
    },
  };
  const first = await runMemoryReview(root, memory, index, runtime, policy);
  assert.equal(first.learning.written, 1);
  assert.equal(memory.search("rollback")[0].id, "rollback-preference");
  await runMemoryReview(root, memory, index, runtime, policy);
  assert.equal(calls, 1);
});

test("maintenance refuses a symlinked canonical session directory without reviewing external history", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "learning-root-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "learning-outside-"));
  const manager = SessionManager.create(outside, outside + "/sessions");
  manager.appendMessage({
    role: "user",
    timestamp: 1,
    content: "I prefer verified targeted rollback copies for routine changes.",
  });
  manager.appendMessage({
    role: "assistant",
    timestamp: 2,
    content: [{ type: "text", text: "Noted." }],
    api: "openai-completions",
    provider: "fixture",
    model: "fixture",
    usage: { input: 0, output: 0, totalTokens: 0 },
    stopReason: "stop",
  });
  const memory = new Memory(root);
  fs.symlinkSync(outside + "/sessions", root + "/state/pi-sessions");
  let called = 0;
  const runtime = {
    getModel: () => ({ id: "fixture" }),
    completeSimple: async () => {
      called++;
      return { content: [{ type: "text", text: '{"observations":[]}' }] };
    },
  };
  const index = {
    rebuild: async () => {},
    load: () => ({ notes: {} }),
    candidates: () => [],
  };
  await assert.rejects(
    runMemoryReview(root, memory, index, runtime, {
      roles: { memoryReviewer: "fixture" },
      maintenance: {},
    }),
    /symlink|boundary|authorized/i,
  );
  assert.equal(called, 0);
  assert.deepEqual(memory.list(), []);
});
test("retrospective reading never migrates or rewrites historical Pi session bytes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "learning-history-"));
  fs.mkdirSync(root + "/work");
  const manager = SessionManager.create(
    root + "/work",
    root + "/state/pi-sessions",
  );
  manager.appendMessage({
    role: "user",
    timestamp: 1,
    content: "I prefer verified targeted rollback copies for routine changes.",
  });
  manager.appendMessage({
    role: "assistant",
    timestamp: 2,
    content: [{ type: "text", text: "Noted." }],
    api: "openai-completions",
    provider: "fixture",
    model: "fixture",
    usage: { input: 0, output: 0, totalTokens: 0 },
    stopReason: "stop",
  });
  const file = manager.getSessionFile(),
    lines = fs.readFileSync(file, "utf8").split("\n");
  const header = JSON.parse(lines[0]);
  header.version = 2;
  lines[0] = JSON.stringify(header);
  fs.writeFileSync(file, lines.join("\n"));
  const before = fs.readFileSync(file, "utf8");
  const memory = new Memory(root);
  const runtime = {
    getModel: () => ({ id: "fixture" }),
    completeSimple: async () => ({
      content: [{ type: "text", text: '{"observations":[]}' }],
    }),
  };
  await runMemoryReview(
    root,
    memory,
    {
      rebuild: async () => {},
      load: () => ({ notes: {} }),
      candidates: () => [],
    },
    runtime,
    { roles: { memoryReviewer: "fixture" }, maintenance: {} },
  );
  assert.equal(fs.readFileSync(file, "utf8"), before);
});
