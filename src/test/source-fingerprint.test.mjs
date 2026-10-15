import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as fingerprint from "../source-fingerprint.mjs";

const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-fingerprint-"));
  fs.mkdirSync(path.join(root, "vendor/amp/src"), { recursive: true });
  fs.mkdirSync(path.join(root, "vendor/amp/dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "app.mjs"), "app");
  fs.writeFileSync(path.join(root, "controller.mjs"), "controller-v1");
  fs.writeFileSync(path.join(root, "vendor/amp/src/index.ts"), "export const v=1;");
  fs.writeFileSync(path.join(root, "vendor/amp/package.json"), "{}\n");
  fs.writeFileSync(path.join(root, "vendor/amp/dist/index.js"), "built-v1");
  return root;
};

test("loaded source fingerprint includes AMP source and keeps runtime files out", () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, "node_modules/private.json"), "MUST_NOT_BE_READ");
  fs.mkdirSync(path.join(root, "runtime"));
  fs.writeFileSync(path.join(root, "runtime/secret"), "MUST_NOT_BE_READ");
  const before = fingerprint.sourceFingerprint(root);
  assert.match(before.sha256, /^[a-f0-9]{64}$/);
  assert.ok(before.files["controller.mjs"]);
  assert.ok(before.ampSourceFiles["vendor/amp/src/index.ts"]);
  assert.ok(before.ampRuntimeFiles["vendor/amp/dist/index.js"]);
  assert.equal(Object.keys(before.files).some((p) => p.includes("node_modules")), false);
  fs.writeFileSync(path.join(root, "vendor/amp/src/index.ts"), "export const v=2;");
  const after = fingerprint.sourceFingerprint(root);
  assert.notEqual(after.ampSourceSha256, before.ampSourceSha256);
  assert.notEqual(after.sha256, before.sha256);
  assert.equal(after.ampRuntimeSha256, before.ampRuntimeSha256);
});

test("source fingerprint rejects symlinked source files and directories", () => {
  const root = fixture();
  fs.symlinkSync(path.join(root, "app.mjs"), path.join(root, "linked.mjs"));
  assert.throws(() => fingerprint.sourceFingerprint(root), /symlink/);
  fs.unlinkSync(path.join(root, "linked.mjs"));
  fs.symlinkSync(path.join(root, "vendor/amp/src"), path.join(root, "vendor/amp/linked-src"));
  assert.throws(() => fingerprint.sourceFingerprint(root), /symlink/);
});

test("git revision and source-only dirty state are reported exactly", () => {
  const root = fixture();
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-git-"));
  fs.cpSync(root, path.join(repo, "src"), { recursive: true });
  const run = (args) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  run(["init", "-q"]); run(["config", "user.email", "test@example.invalid"]); run(["config", "user.name", "Test"]);
  run(["add", "."]); run(["commit", "-qm", "initial"]);
  const clean = fingerprint.sourceFingerprint(path.join(repo, "src"));
  assert.match(clean.gitRevision, /^[a-f0-9]{40}$/);
  assert.equal(clean.gitDirty, false);
  // Uncommitted tracked source change → dirty
  fs.writeFileSync(path.join(repo, "src/vendor/amp/src/index.ts"), "changed");
  const dirty = fingerprint.sourceFingerprint(path.join(repo, "src"));
  assert.equal(dirty.gitRevision, clean.gitRevision);
  assert.equal(dirty.gitDirty, true);
  // After committing that change, adding an untracked non-source file must not trigger dirty.
  run(["add", "."]); run(["commit", "-qm", "update-amp"]);
  fs.writeFileSync(path.join(repo, "src/README.md"), "untracked non-source");
  assert.equal(fingerprint.sourceFingerprint(path.join(repo, "src")).gitDirty, false);
});

test("non-git fixtures remain applicable without reading runtime or secrets", () => {
  const root = fixture();
  const result = fingerprint.sourceFingerprint(root);
  assert.equal(result.gitRevision, null);
  assert.equal(result.gitDirty, null);
  assert.equal(result.ampLaunchCorrespondence, "not-evaluated");
});
