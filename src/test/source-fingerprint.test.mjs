import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as fingerprint from "../source-fingerprint.mjs";
test("loaded source fingerprint detects component changes even when app.mjs is unchanged", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-fingerprint-"));
  fs.writeFileSync(root + "/app.mjs", "app");
  fs.writeFileSync(root + "/controller.mjs", "controller-v1");
  fs.mkdirSync(root + "/node_modules");
  fs.writeFileSync(root + "/node_modules/private.json", "MUST_NOT_BE_READ");
  const before = fingerprint.sourceFingerprint(root);
  assert.match(before.sha256, /^[a-f0-9]{64}$/);
  assert.ok(before.files["controller.mjs"]);
  assert.equal(
    Object.keys(before.files).some((p) => p.includes("node_modules")),
    false,
  );
  fs.writeFileSync(root + "/controller.mjs", "controller-v2");
  const after = fingerprint.sourceFingerprint(root);
  assert.notEqual(after.sha256, before.sha256);
  assert.equal(after.files["app.mjs"], before.files["app.mjs"]);
});
