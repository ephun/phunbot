import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Memory } from "../memory.mjs";
import { consolidateSessions } from "../retrospective.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-learning-"));
  return { root, memory: new Memory(root) };
}
const session = {
  id: "session-one",
  entries: [
    {
      id: "user-one",
      type: "message",
      message: {
        role: "user",
        content: [
          {
            type: "text",
            text: "For future work, I prefer targeted rollback copies instead of full backups for small changes.",
          },
        ],
      },
    },
    {
      id: "assistant-one",
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "PRIVATE_REASONING" },
          { type: "text", text: "Understood." },
        ],
      },
    },
  ],
};
const proposal = {
  id: "targeted-rollback",
  title: "Targeted rollback preference",
  body: "The owner prefers targeted reversible rollback copies for small changes.",
  sourceIds: ["user-one"],
  durable: true,
  reason: "A stable preference explicitly stated by the owner.",
};

test("retrospective learning writes atomic knowledge with provenance and incrementally skips reviewed entries", async () => {
  const { root, memory } = fixture();
  let calls = 0;
  const review = async (input) => {
    calls++;
    assert.ok(!JSON.stringify(input).includes("PRIVATE_REASONING"));
    return { observations: [proposal] };
  };
  const report = await consolidateSessions(root, memory, [session], review);
  assert.equal(report.written, 1);
  assert.match(memory.get(proposal.id), /session-one.*user-one/);
  assert.equal(memory.search("rollback")[0].id, proposal.id);
  await consolidateSessions(root, memory, [session], review);
  assert.equal(calls, 1);
  const changed = structuredClone(session);
  changed.entries.push({
    id: "user-two",
    type: "message",
    message: { role: "user", content: [{ type: "text", text: "Thanks." }] },
  });
  await consolidateSessions(root, memory, [changed], async (input) => {
    assert.deepEqual(
      input.records.map((r) => r.id),
      ["user-two"],
    );
    return { observations: [] };
  });
});

test("unsupported assistant-only and low-value observations cannot enter semantic memory", async () => {
  const { root, memory } = fixture();
  const report = await consolidateSessions(
    root,
    memory,
    [session],
    async () => ({
      observations: [
        { ...proposal, sourceIds: ["assistant-one"] },
        { ...proposal, id: "filler", body: "Thanks.", durable: false },
        { ...proposal, id: "invented", sourceIds: ["invented-entry"] },
      ],
    }),
  );
  assert.equal(report.written, 0);
  assert.equal(report.rejected, 3);
  assert.equal(memory.list().length, 0);
});

test("session review rotates fairly instead of repeatedly preferring an active history", async () => {
  const { root, memory } = fixture();
  const first = structuredClone(session),
    second = structuredClone(session);
  second.id = "session-two";
  const seen = [];
  const review = async (input) => {
    seen.push(input.sessionId);
    return { observations: [] };
  };
  await consolidateSessions(root, memory, [first, second], review);
  first.entries.push({
    id: "new-input",
    type: "message",
    message: { role: "user", content: "A new message in the active history." },
  });
  await consolidateSessions(root, memory, [first, second], review);
  assert.deepEqual(seen, ["session-one", "session-two"]);
});

test("failed review does not advance the durable session learning cursor", async () => {
  const { root, memory } = fixture();
  await assert.rejects(
    () =>
      consolidateSessions(root, memory, [session], async () => {
        throw Error("provider unavailable");
      }),
    /provider unavailable/,
  );
  const report = await consolidateSessions(
    root,
    memory,
    [session],
    async () => ({ observations: [proposal] }),
  );
  assert.equal(report.written, 1);
});

test("overlapping maintenance serializes session learning and never reviews the same entry concurrently", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "learning-concurrent-"));
  const memory = new Memory(root);
  const sessions = [
    {
      id: "shared-session",
      entries: [
        {
          id: "entry-one",
          type: "message",
          message: {
            role: "user",
            content: "A durable owner preference with appropriate provenance.",
          },
        },
      ],
    },
  ];
  let reviews = 0,
    started;
  const ready = new Promise((resolve) => (started = resolve));
  let finish;
  const gate = new Promise((resolve) => (finish = resolve));
  const review = async () => {
    reviews++;
    started();
    await gate;
    return { observations: [] };
  };
  const first = consolidateSessions(root, memory, sessions, review);
  await ready;
  const second = consolidateSessions(root, memory, sessions, review);
  await new Promise((resolve) => setTimeout(resolve, 10));
  finish();
  const results = await Promise.all([first, second]);
  assert.equal(reviews, 1);
  assert.equal(results.filter((result) => result.busy).length, 1);
  assert.equal(
    JSON.parse(fs.readFileSync(root + "/state/session-learning.json")).sessions[
      "shared-session"
    ],
    "entry-one",
  );
});
