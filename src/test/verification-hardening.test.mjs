import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Controller } from "../controller.mjs";
import { parseObject, parseReviewerResult } from "../review-output.mjs";
import { projectGoalForReview } from "../planning.mjs";

class Tasks { constructor() { this.data = new Map(); } async get(id) { return structuredClone(this.data.get(id)); } async put(v) { const x = structuredClone({...v, etag: `"${this.data.size + 1}"`}); this.data.set(x.id, x); return x; } }
function setup() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-hardening-")); const nc = new Tasks(); const c = new Controller(root, nc); nc.data.set("g", {id:"g",request:"x",status:"NEEDS-ACTION"}); return {c}; }

test("verification fingerprint deduplicates repeated reads and ignores diagnostic/control churn", () => {
  const {c} = setup();
  c.record("g", "read", {path:"a", diagnosticId:"one", at:"2020"}, {value:"same", traceId:"one"});
  const first = c.verificationFingerprint("g");
  c.record("g", "read", {path:"a", diagnosticId:"two", at:"2021"}, {value:"same", traceId:"two"});
  c.record("g", "control_receipt", {requestId:"x"}, {state:"changed", uuid:crypto.randomUUID()});
  assert.equal(c.verificationFingerprint("g"), first);
  c.record("g", "read", {path:"a"}, {value:"changed"});
  assert.notEqual(c.verificationFingerprint("g"), first);
});

test("oversized evidence has a private durable loader, not only a preview", () => {
  const {c} = setup();
  const e = c.record("g", "read", {}, {content:"x".repeat(20000)});
  assert.equal(c.loadEvidenceResult("g", e.id).content.length, 20000);
  assert.equal(JSON.parse(e.result).truncated, true);
});

test("native output rejects stale slices and non-final debug output", () => {
  const {c} = setup(); const started = Date.now(); c.beginSlice("g", started);
  c.record("g", "assistant_output", {}, {source:"Actual Pi assistant output; not independent proof of external state",text:"debug",final:false});
  assert.equal(c.nativeFinalOutput("g"), null);
  c.record("g", "assistant_output", {}, {source:"Actual Pi assistant output; not independent proof of external state",text:"final",final:true});
  assert.equal(c.nativeFinalOutput("g").text, "final");
  c.beginSlice("g", Date.now() + 1000);
  assert.equal(c.nativeFinalOutput("g"), null);
});

test("review parsing has a separate bound and understands provider stop reasons", () => {
  assert.doesNotThrow(() => parseObject(JSON.stringify({description:"x".repeat(30000)})));
  assert.throws(() => parseReviewerResult('{"pass":true,"reason":"ok"}', "length"), /stop reason/i);
  assert.equal(parseReviewerResult('{"pass":true,"reason":"ok"}', "stop").pass, true);
});

test("review goal projection excludes authorization and verification control state", () => {
  assert.deepEqual(projectGoalForReview({id:"g",request:"x",authorizations:["secret"],controlReceipts:["r"],verificationReceipts:{a:"b"},verificationHistory:["h"],status:"NEEDS-ACTION"}), {id:"g",request:"x",status:"NEEDS-ACTION"});
});
