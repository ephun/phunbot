import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Controller } from "../controller.mjs";
import { parseReview, ReviewParseError } from "../review-output.mjs";

class Tasks {
  constructor() { this.data = new Map(); }
  async put(value) { const next = structuredClone({ ...value, etag: `"${this.data.size + 1}"` }); this.data.set(next.id, next); return next; }
  async get(id) { return structuredClone(this.data.get(id)); }
  async list() { return [...this.data.values()].map(structuredClone); }
}
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-bounds-"));
  const nc = new Tasks();
  return { root, nc, c: new Controller(root, nc) };
}

test("record keeps oversized diagnostics valid JSON instead of slicing JSON", () => {
  const { c } = setup();
  const g = { id: "g", request: "x", status: "NEEDS-ACTION" };
  c.nc.data.set(g.id, g);
  const e = c.record(g.id, "tool", {}, { diagnostic: "x".repeat(20000) });
  assert.doesNotThrow(() => JSON.parse(e.result));
  assert.equal(JSON.parse(e.result).truncated, true);
  assert.equal(typeof JSON.parse(e.result).sha256, "string");
});

test("review parser reports typed length, empty, and malformed failures without accepting truncation", () => {
  assert.throws(() => parseReview("x".repeat(13000)), (e) => e instanceof ReviewParseError && e.code === "length");
  assert.throws(() => parseReview(""), (e) => e instanceof ReviewParseError && e.code === "empty");
  assert.throws(() => parseReview('{"pass":true,"reason":"cut'), (e) => e instanceof ReviewParseError && e.code === "malformed");
});

test("evidence remains durable while the UI page is explicitly bounded", () => {
  const { c } = setup();
  c.nc.data.set("g", { id: "g", request: "x", status: "NEEDS-ACTION" });
  for (let i = 0; i < 125; i++) c.record("g", "read", { n: i }, { value: i });
  assert.equal(c.checkpoint("g").evidence.length, 125);
  assert.equal(c.evidencePage("g", { limit: 10 }).events.length, 10);
  assert.equal(c.evidencePage("g", { limit: 10 }).total, 125);
});

test("verification failure identity ignores candidate wording and diagnostic UUIDs", () => {
  const { c } = setup();
  c.nc.data.set("g", { id: "g", request: "x", status: "NEEDS-ACTION" });
  const a = c.failureKey("goal_verify", { taskId: "task", revision: 2, answer: "short" }, "g");
  const b = c.failureKey("goal_verify", { taskId: "task", revision: 2, answer: "a much longer alternative answer" }, "g");
  assert.equal(a, b);
  c.record("g", "read", { target: "same" }, { diagnosticId: "one", content: "new" }, false);
  const cKey = c.failureKey("goal_verify", { taskId: "task", revision: 2, answer: "different" }, "g");
  assert.notEqual(a, cKey);
});

test("native final output can be read without accepting completion", () => {
  const { c } = setup();
  c.nc.data.set("g", { id: "g", request: "x", status: "NEEDS-ACTION" });
  c.record("g", "assistant_output", {}, { source: "Actual Pi assistant output; not independent proof of external state", text: "Useful answer", final: true }, false);
  assert.equal(c.nativeFinalOutput("g").text, "Useful answer");
  assert.equal(c.nativeFinalOutput("g").final, true);
});
