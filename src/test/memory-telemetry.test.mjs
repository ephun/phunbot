import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { Memory } from "../memory.mjs";
import { MemoryTelemetry } from "../memory-telemetry.mjs";
const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");
function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "phunbot-memory-telemetry-test-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const log = (root) =>
  path.join(root, "state/memory-telemetry/observations.jsonl");
const rows = (root) =>
  fs
    .readFileSync(log(root), "utf8")
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);

test("create, retrieve, revise, supersede and delete retain exact hash lineage across restart", (t) => {
  const root = fixture(t),
    m = new Memory(root);
  const a = "---\nid: a\nstatus: observed\n---\n\n# Synthetic A\n";
  const b = a + "Revision.\n";
  assert.deepEqual(m.save("a", a), { id: "a", sha256: hash(a) });
  m.search("Synthetic");
  assert.equal(m.get("a"), a);
  new Memory(root).save("a", b);
  m.save("successor", "# Successor\n");
  m.supersede("a", "successor");
  assert.match(m.get("a"), /^status: superseded$/m);
  assert.match(m.get("a"), /^superseded_by: successor$/m);
  m.delete("a");
  m.delete("a");
  const events = rows(root);
  const revisions = events.filter(
    (e) =>
      ["create", "revise", "supersede", "delete"].includes(e.operation) &&
      e.notes[0].id === "a",
  );
  assert.deepEqual(
    revisions.map((e) => e.operation),
    ["create", "revise", "supersede", "delete"],
  );
  assert.equal(revisions[1].previousVersion, hash(a));
  assert.equal(revisions[1].notes[0].version, hash(b));
  for (const e of revisions.slice(1))
    assert.equal(
      hash(
        fs.readFileSync(
          root + "/state/memory-revisions/" + e.preservedRevision,
          "utf8",
        ),
      ),
      e.previousVersion,
    );
  assert.equal(events.filter((e) => e.operation === "delete").length, 1);
  assert.ok(
    events.every((e) => e.eventId && e.observedAt && e.schemaVersion === 1),
  );
  assert.equal(
    events.some((e) => e.operation === "merge" || e.operation === "split"),
    false,
  );
});

test("central writes capture relationship create, modify, removal and inferred status without reasons", (t) => {
  const root = fixture(t),
    m = new Memory(root);
  m.save("a", "# A\n");
  m.save("b", "# B\n");
  m.link("a", "b", "Synthetic inferred rationale");
  m.link("a", "b", "No actual change");
  m.save(
    "a",
    m
      .get("a")
      .replace("Synthetic inferred rationale", "Updated private rationale"),
  );
  m.save("a", "# A\n[[b|Explicit label]]\n");
  m.save("a", "# A\n");
  const events = rows(root).filter((e) => e.operation === "relationship");
  assert.deepEqual(
    events.filter((e) => e.source.id === "a").map((e) => e.action),
    ["created", "modified", "modified", "removed"],
  );
  assert.equal(events[0].kind, "inferred");
  assert.equal(events.findLast((e) => e.action === "removed").kind, "explicit");
  assert.equal(JSON.stringify(events).includes("rationale"), false);
});

test("ranked retrieval is not a relationship and context records only contributing slices", (t) => {
  const root = fixture(t),
    m = new Memory(root);
  m.save("a", "Astronomy " + ".".repeat(13000));
  m.save("b", "Astronomy Beta");
  const notes = m.search("Astronomy");
  const text = notes
    .map((n) => n.text)
    .join("\n\n")
    .slice(0, 12000);
  m.recordContextSupply(notes, text);
  const e = rows(root).at(-1);
  assert.equal(e.operation, "context");
  assert.equal(e.notes.length, 1);
  assert.equal(e.notes[0].includedChars, 12000);
  assert.equal(e.notes[0].truncated, true);
  assert.equal(e.notes[0].version, hash(notes[0].text));
  const search = rows(root).find((e) => e.operation === "search");
  assert.deepEqual(
    search.notes.map((n) => n.rank),
    [1, 2],
  );
  assert.equal(
    rows(root).some((e) => e.operation === "relationship"),
    false,
  );
  assert.equal(JSON.stringify(rows(root)).includes("Astronomy"), false);
});

test("async provenance scopes do not cross-contaminate concurrent goals", async (t) => {
  const root = fixture(t),
    m = new Memory(root);
  m.save("a", "# A");
  await Promise.all(
    ["one", "two"].map((goalId, i) =>
      m.withContext(
        { sessionId: "session-" + i, goalId, phase: "agent" },
        async () => {
          await new Promise((r) => setTimeout(r, i ? 1 : 10));
          m.get("a");
        },
      ),
    ),
  );
  assert.deepEqual(
    rows(root)
      .filter((e) => e.operation === "read")
      .map((e) => [e.context.goalId, e.context.sessionId])
      .sort(),
    [
      ["one", "session-0"],
      ["two", "session-1"],
    ],
  );
});

test("real concurrent processes append complete records and preserve all observations", async (t) => {
  const root = fixture(t);
  new Memory(root).save("shared", "# Shared");
  const module = new URL("../memory.mjs", import.meta.url).href;
  const children = Array.from(
    { length: 4 },
    (_, i) =>
      new Promise((resolve, reject) => {
        const code = `import {Memory} from ${JSON.stringify(module)};const m=new Memory(${JSON.stringify(root)});for(let j=0;j<10;j++){m.save('worker-${i}-'+j,'# Synthetic '+j);m.get('shared');}if(!m.telemetryStatus().ok)process.exit(3);`;
        const child = spawn(
          process.execPath,
          ["--input-type=module", "-e", code],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        let stderr = "";
        child.stderr.on("data", (d) => (stderr += d));
        child.on("error", reject);
        child.on("exit", (c) =>
          c === 0
            ? resolve()
            : reject(Error("child exit " + c + ": " + stderr)),
        );
      }),
  );
  await Promise.all(children);
  const events = rows(root);
  assert.equal(events.filter((e) => e.operation === "create").length, 41);
  assert.equal(events.filter((e) => e.operation === "read").length, 40);
  assert.equal(new Set(events.map((e) => e.eventId)).size, events.length);
  assert.equal(new Memory(root).telemetryStatus().ok, true);
});

test("malformed JSON, unfinished tails and schema-invalid records fail closed without rewriting history", (t) => {
  for (const bad of [
    "not-json\n",
    '{"schemaVersion":1}',
    JSON.stringify({
      schemaVersion: 1,
      eventId: "not-uuid",
      operation: "read",
      outcome: "observed",
    }) + "\n",
  ]) {
    const root = fixture(t);
    new Memory(root);
    fs.writeFileSync(log(root), bad);
    const m = new Memory(root);
    m.save("a", "# A");
    assert.equal(m.telemetryStatus().ok, false);
    assert.equal(fs.readFileSync(log(root), "utf8"), bad);
  }
});

test("instrumentation failures are sticky across success and restart, not hidden by read return values", (t) => {
  const root = fixture(t),
    m = new Memory(root);
  m.save("a", "# A");
  const original = fs.writeSync;
  fs.writeSync = () => {
    throw Object.assign(Error("synthetic ENOSPC private user text"), {
      code: "ENOSPC",
    });
  };
  try {
    assert.equal(m.get("a"), "# A");
  } finally {
    fs.writeSync = original;
  }
  assert.equal(m.telemetryStatus().ok, false);
  m.get("a");
  assert.equal(m.telemetryStatus().ok, false);
  assert.equal(new Memory(root).telemetryStatus().ok, false);
  assert.equal(
    JSON.stringify(m.telemetryStatus()).includes("private user text"),
    false,
  );
});

test("partial appends cannot be followed by apparently successful events", (t) => {
  const root = fixture(t),
    m = new Memory(root);
  m.save("a", "# A");
  const original = fs.writeSync;
  let calls = 0;
  fs.writeSync = (fd, bytes, offset, length, ...rest) => {
    if (++calls === 1)
      return original(fd, bytes, offset, Math.min(9, length), ...rest);
    throw Object.assign(Error("fixture"), { code: "ENOSPC" });
  };
  try {
    m.get("a");
  } finally {
    fs.writeSync = original;
  }
  const broken = fs.readFileSync(log(root), "utf8");
  assert.equal(broken.endsWith("\n"), false);
  m.get("a");
  assert.equal(fs.readFileSync(log(root), "utf8"), broken);
  assert.equal(new Memory(root).telemetryStatus().ok, false);
});

test("failed memory mutations never produce successful mutation observations", (t) => {
  const root = fixture(t),
    m = new Memory(root);
  m.save("a", "# Prior");
  assert.throws(
    () => m.save("a", "API_KEY=" + "sk-" + "fixture".repeat(8)),
    /secret/i,
  );
  assert.equal(m.get("a"), "# Prior");
  assert.equal(rows(root).filter((e) => e.operation === "revise").length, 0);
  assert.throws(() => m.supersede("a", "missing"));
  assert.equal(
    rows(root).some((e) => e.operation === "supersede"),
    false,
  );
  assert.throws(() => m.get("missing"));
  assert.equal(
    rows(root).filter((e) => e.operation === "operation_failed").length >= 2,
    true,
  );
});

test("schema rejects unnecessary text and unknown nested fields", (t) => {
  const root = fixture(t),
    m = new Memory(root);
  const e = m.telemetry.emit("read", {
    notes: [{ id: "demo", version: "a".repeat(64), text: "Private body" }],
  });
  assert.equal(e.ok, false);
  const second = new MemoryTelemetry(fixture(t));
  assert.throws(() =>
    second.withContext({ phase: "Unnecessary sensitive text" }, () => {}),
  );
});

test("reconciliation reports external changes as observations, not manufactured revisions", (t) => {
  const root = fixture(t),
    m = new Memory(root);
  m.save("a", "# A");
  m.save("deleted", "# Delete");
  fs.writeFileSync(root + "/memory/a.md", "# Owner edit");
  fs.unlinkSync(root + "/memory/deleted.md");
  fs.writeFileSync(root + "/memory/external.md", "# External");
  const report = m.reconcileTelemetry();
  assert.deepEqual(report.differences.map((n) => [n.id, n.state]).sort(), [
    ["a", "changed"],
    ["deleted", "missing"],
    ["external", "untracked"],
  ]);
  assert.equal(rows(root).filter((e) => e.operation === "revise").length, 0);
  assert.equal(rows(root).at(-1).operation, "reconcile");
});

test("enumeration and semantic searches larger than a batch do not drop results", async (t) => {
  const root = fixture(t),
    m = new Memory(root);
  for (let i = 0; i < 105; i++) m.save("note-" + i, "# Synthetic");
  assert.equal(m.list().length, 105);
  assert.equal(m.telemetryStatus().ok, true);
  const enumeration = rows(root).filter((e) => e.operation === "enumerate");
  assert.equal(
    enumeration.reduce((s, e) => s + e.notes.length, 0),
    105,
  );
  assert.equal(new Set(enumeration.map((e) => e.batchId)).size, 1);
});

test("privacy validation rejects cross-operation payload fields and impossible versions", (t) => {
  for (const fields of [
    {
      notes: [{ id: "demo", version: "a".repeat(64) }],
      source: { text: "Private unrelated payload" },
    },
    { notes: [{ id: "demo", version: null }] },
  ]) {
    const m = new Memory(fixture(t));
    assert.equal(m.telemetry.emit("read", fields).ok, false);
    assert.equal(rows(m.root).length, 0);
  }
});
test("context slicing handles empty notes and delimiter-only truncation", (t) => {
  const root = fixture(t),
    m = new Memory(root);
  m.recordContextSupply(
    [
      { id: "empty", text: "" },
      { id: "present", text: "ABCDE" },
    ],
    "\n\nABC",
  );
  let e = rows(root).at(-1);
  assert.deepEqual(
    e.notes.map((n) => [n.id, n.includedChars]),
    [["present", 3]],
  );
  m.recordContextSupply(
    [
      { id: "first", text: "123" },
      { id: "second", text: "ABC" },
    ],
    "123\n",
  );
  e = rows(root).at(-1);
  assert.deepEqual(
    e.notes.map((n) => n.id),
    ["first"],
  );
});

test("production retrospective and maintenance dispatches record exact scoped context on retries", async (t) => {
  const root = fixture(t);
  fs.mkdirSync(root + "/work");
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const { Index } = await import("../index.mjs");
  const { runMemoryReview } = await import("../memory-review.mjs");
  const manager = SessionManager.create(
    root + "/work",
    root + "/state/pi-sessions",
  );
  manager.appendMessage({
    role: "user",
    timestamp: 1,
    content: "For future synthetic astronomy work I prefer observing planets.",
  });
  manager.appendMessage({
    role: "assistant",
    timestamp: 2,
    content: [{ type: "text", text: "Noted." }],
    api: "test",
    provider: "fixture",
    model: "fixture",
    usage: { input: 0, output: 0, totalTokens: 0 },
    stopReason: "stop",
  });
  const m = new Memory(root);
  m.save("a", "Synthetic astronomy " + "A".repeat(2200));
  m.save("b", "Synthetic astronomy B");
  const index = new Index(root, m, async (texts) => texts.map(() => [1, 0]));
  let pairCalls = 0,
    existing;
  const runtime = {
    getModel: () => ({ id: "fixture" }),
    completeSimple: async (model, payload) => {
      const input = JSON.parse(payload.messages[0].content[0].text);
      let verdict;
      if (input.existingNotes) {
        existing = input.existingNotes;
        verdict = { observations: [] };
      } else {
        pairCalls++;
        verdict = {
          related: false,
          contradiction: false,
          redundant: false,
          reason: "Synthetic independent notes.",
        };
      }
      return {
        content: [
          {
            type: "text",
            text:
              pairCalls === 1 && !input.existingNotes
                ? "invalid-json"
                : JSON.stringify(verdict),
          },
        ],
      };
    },
  };
  await runMemoryReview(root, m, index, runtime, {
    provider: "fixture",
    roles: { reviewer: "fixture" },
    maintenance: {
      maxPairsPerRun: 1,
      maxSessionsPerRun: 1,
      reviewTimeoutMs: 1000,
      maxReviewAttempts: 2,
    },
  });
  const contexts = rows(root).filter((e) => e.operation === "context");
  const historical = contexts.find((e) => e.context.phase === "retrospective");
  assert.equal(historical.context.sessionId, manager.getSessionId());
  assert.equal(historical.notes.find((n) => n.id === "a").includedChars, 2000);
  assert.equal(existing.find((n) => n.id === "a").text.length, 2000);
  assert.equal(pairCalls, 2);
  assert.equal(
    contexts.filter((e) => e.context.phase === "maintenance").length,
    2,
  );
  assert.ok(
    rows(root)
      .filter((e) => e.operation === "enumerate")
      .every((e) => e.context.phase === "maintenance"),
  );
});
test("in-process malformed append is detected and explicit reconciliation acknowledges a gap durably", (t) => {
  const root = fixture(t),
    m = new Memory(root);
  m.save("a", "# A");
  const prior = fs.readFileSync(log(root), "utf8");
  fs.appendFileSync(log(root), "bad-record\n");
  m.get("a");
  assert.equal(m.telemetryStatus().ok, false);
  // Explicit synthetic operator repair; normal application never rewrites history.
  fs.writeFileSync(log(root), prior);
  assert.equal(m.reconcileTelemetry().ok, false);
  const result = m.reconcileTelemetry({ acknowledgeGap: true });
  assert.equal(result.ok, true);
  assert.equal(rows(root).at(-1).operation, "reconcile");
  assert.equal(new Memory(root).telemetryStatus().ok, true);
});
