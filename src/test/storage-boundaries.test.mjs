import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Index } from "../index.mjs";
import { Memory } from "../memory.mjs";
import { maintain } from "../maintenance.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-storage-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-outside-"));
  const memory = new Memory(root);
  memory.put(
    "sample",
    "Sample",
    "A durable independently authored observation.",
    "fixture",
  );
  return { root, outside, memory };
}
test("embedding index rejects a symlinked cache before any outside read or write", async () => {
  const { root, outside, memory } = fixture();
  fs.symlinkSync(outside, root + "/cache");
  const index = new Index(root, memory, async (texts) =>
    texts.map(() => [1, 0]),
  );
  await assert.rejects(() => index.rebuild(), /symlink|boundary/i);
  assert.deepEqual(fs.readdirSync(outside), []);
});
test("maintenance rejects a symlinked report destination without touching outside bytes", async () => {
  const { root, outside, memory } = fixture();
  const index = new Index(root, memory, async (texts) =>
    texts.map(() => [1, 0]),
  );
  fs.writeFileSync(outside + "/human", "untouched");
  fs.symlinkSync(outside + "/human", root + "/state/last-memory-review.json");
  await assert.rejects(
    () =>
      maintain(root, memory, index, async () => ({
        related: false,
        contradiction: false,
        reason: "none",
      })),
    /symlink/i,
  );
  assert.equal(fs.readFileSync(outside + "/human", "utf8"), "untouched");
  assert.equal(
    fs.lstatSync(root + "/state/last-memory-review.json").isSymbolicLink(),
    true,
  );
});
test("memory enumeration rejects symlinked roots and individual notes", () => {
  const { root, outside, memory } = fixture();
  fs.writeFileSync(outside + "/hidden.md", "OUTSIDE");
  fs.symlinkSync(outside + "/hidden.md", root + "/memory/outside.md");
  assert.throws(() => memory.list(), /symlink/i);
});
