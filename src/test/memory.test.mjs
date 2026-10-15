import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Memory } from "../memory.mjs";
test("Markdown memory preserves source revisions and human links while supporting exact retrieval", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-memory-"));
  const m = new Memory(root);
  m.put(
    "agent-identity",
    "phunbot Identity",
    "phunbot runs through Pi.",
    "user request",
  );
  m.put(
    "task-authority",
    "Goal Authority",
    "Nextcloud Tasks is authoritative.",
    "user request",
  );
  m.link(
    "agent-identity",
    "task-authority",
    "LLM evaluated semantic relationship",
  );
  let raw = fs.readFileSync(root + "/memory/agent-identity.md", "utf8");
  assert.match(raw, /\[\[task-authority\]\]/);
  m.put(
    "agent-identity",
    "phunbot Identity",
    "Updated identity.",
    "verified user correction",
  );
  assert.equal(m.search("Nextcloud")[0].id, "task-authority");
  assert.ok(fs.readdirSync(root + "/state/memory-revisions").length);
  assert.match(
    fs.readFileSync(root + "/memory/agent-identity.md", "utf8"),
    /\[\[task-authority\]\]/,
  );
  assert.throws(() => m.put("../escape", "bad", "bad", "bad"));
});
test("memory rejects symlink escapes and secrets while preserving prior source on rejected updates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-memory-secure-"));
  const m = new Memory(root);
  fs.writeFileSync(root + "/outside.txt", "PRIVATE_FIXTURE");
  fs.symlinkSync(root + "/outside.txt", root + "/memory/escape-note.md");
  assert.throws(() => m.get("escape-note"), /symlink|outside/i);
  m.put("safe-note", "Safe", "Prior source.", "fixture");
  assert.throws(
    () =>
      m.put(
        "safe-note",
        "Safe",
        "API_KEY=" + "controlled-test-fixture",
        "fixture",
      ),
    /secret/i,
  );
  assert.match(m.get("safe-note"), /Prior source/);
});

test("ordinary observations preserve all manual sections and metadata byte-for-byte", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-memory-manual-"));
  const m = new Memory(root);
  const original =
    "---\nid: host-notes\nauthor: owner\ncustom: keep-this\n---\n\n# Host notes\n\nHuman-authored description.\n\n## Recovery cautions\nNever erase the manual rollback instructions.\n";
  m.save("host-notes", original);
  m.put(
    "host-notes",
    "Host notes",
    "A verified reusable procedure was discovered.",
    "goal:fixture evidence:readback",
  );
  assert.ok(m.get("host-notes").startsWith(original));
  assert.match(m.get("host-notes"), /verified reusable procedure/);
  const updated = m.get("host-notes");
  m.put(
    "host-notes",
    "Host notes",
    "A verified reusable procedure was discovered.",
    "goal:fixture evidence:readback",
  );
  assert.equal(m.get("host-notes"), updated);
});

test("memory refuses symlinked revision or lock directories before creating any external files", () => {
  for (const directory of ["memory-locks", "memory-revisions"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-boundary-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "memory-external-"));
    fs.mkdirSync(root + "/state");
    fs.symlinkSync(outside, root + "/state/" + directory);
    assert.throws(() => {
      const memory = new Memory(root);
      memory.put("note", "Title", "Supported initial observation.", "fixture");
      memory.put("note", "Title", "Supported second observation.", "fixture");
    }, /symlink|boundary|authorized/i);
    assert.deepEqual(fs.readdirSync(outside), []);
  }
});
