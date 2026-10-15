import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sourceFingerprint, sourceDrift } from "../source-fingerprint.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-identity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (name, data) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), data);
  };
  put("app.mjs", "app");
  put("controller.mjs", "controller-v1");
  put("vendor/amp/src/index.ts", "export const v=1;");
  put("vendor/amp/package.json", "{}\n");
  put("vendor/amp/package-lock.json", "{}\n");
  put("vendor/amp/tsconfig.json", "{}\n");
  put("vendor/amp/dist/index.js", "built-v1");
  return { root, put };
}

function git(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

test("AMP TypeScript and build manifests affect source hash, built adapter is separate", (t) => {
  const { root, put } = fixture(t);
  const before = sourceFingerprint(root);
  assert.ok(before.files["vendor/amp/package.json"]);
  assert.ok(before.files["vendor/amp/package-lock.json"]);
  assert.ok(before.files["vendor/amp/tsconfig.json"]);
  put("vendor/amp/src/index.ts", "export const v=2;");
  const changed = sourceFingerprint(root);
  assert.notEqual(changed.sha256, before.sha256);
  assert.equal(changed.ampRuntimeSha256, before.ampRuntimeSha256);
  put("vendor/amp/dist/index.js", "built-v2");
  const rebuilt = sourceFingerprint(root);
  assert.equal(rebuilt.sha256, changed.sha256);
  assert.notEqual(rebuilt.ampRuntimeSha256, changed.ampRuntimeSha256);
});

test("current disk changes and deleted files are detected against startup snapshot", (t) => {
  const { root, put } = fixture(t);
  const startup = sourceFingerprint(root);
  assert.equal(sourceDrift(startup, root).drifted, false);
  put("controller.mjs", "changed");
  assert.equal(sourceDrift(startup, root).drifted, true);
  assert.equal(startup.files["app.mjs"], sourceFingerprint(root).files["app.mjs"]);
  fs.unlinkSync(path.join(root, "app.mjs"));
  assert.equal(sourceDrift(startup, root).drifted, true);
});

test("secrets/config/vault/runtime/dependencies are never opened or traversed", (t) => {
  const { root, put } = fixture(t);
  const before = sourceFingerprint(root);
  for (const name of ["config/secrets/private.mjs", "auth/private.mjs", "vault/private.mjs", "runtime/private.mjs", "node_modules/private.mjs"]) put(name, "SECRET_SENTINEL");
  const read = fs.readFileSync, list = fs.readdirSync, open = fs.openSync;
  const forbidden = /(?:config|auth|vault|runtime|node_modules)\//;
  fs.openSync = (name, ...args) => {
    assert.equal(forbidden.test(path.relative(root, String(name))), false, String(name));
    return open(name, ...args);
  };
  fs.readFileSync = (name, ...args) => {
    assert.equal(forbidden.test(path.relative(root, String(name))), false, String(name));
    return read(name, ...args);
  };
  fs.readdirSync = (name, ...args) => {
    assert.equal(forbidden.test(path.relative(root, String(name)) + "/"), false, String(name));
    return list(name, ...args);
  };
  try { assert.equal(sourceFingerprint(root).sha256, before.sha256); }
  finally { fs.readFileSync = read; fs.readdirSync = list; fs.openSync = open; }
});

test("rejects symlinked source, intermediate vendor directories and source root", (t) => {
  const { root } = fixture(t);
  fs.symlinkSync(path.join(root, "app.mjs"), path.join(root, "linked.mjs"));
  assert.throws(() => sourceFingerprint(root), /symlink/);
  fs.unlinkSync(path.join(root, "linked.mjs"));
  fs.renameSync(path.join(root, "vendor"), path.join(root, "saved-vendor"));
  fs.symlinkSync(path.join(root, "saved-vendor"), path.join(root, "vendor"));
  assert.throws(() => sourceFingerprint(root), /symlink/);
  const alias = root + "-alias";
  fs.symlinkSync(root, alias);
  t.after(() => fs.unlinkSync(alias));
  assert.throws(() => sourceFingerprint(alias), /symlink/);
});

test("exact Git HEAD and source-only dirty applicability include deletions and untracked source", (t) => {
  const { root, put } = fixture(t);
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Fixture"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["add", "."]); git(root, ["commit", "-qm", "fixture"]);
  const clean = sourceFingerprint(root);
  assert.equal(clean.gitRevision, git(root, ["rev-parse", "HEAD"]));
  assert.equal(clean.gitDirty, false);
  put("config/secrets.json", "not fingerprinted");
  put("README.md", "documentation");
  assert.equal(sourceFingerprint(root).gitDirty, false);
  put("vendor/amp/package.json", '{"changed":true}');
  assert.equal(sourceFingerprint(root).gitDirty, true);
  git(root, ["restore", "vendor/amp/package.json"]);
  fs.unlinkSync(path.join(root, "app.mjs"));
  assert.equal(sourceFingerprint(root).gitDirty, true);
  git(root, ["restore", "app.mjs"]);
  put("new.mjs", "new source");
  assert.equal(sourceFingerprint(root).gitDirty, true);
  assert.deepEqual(sourceFingerprint(root).untrackedSourcePaths, ["new.mjs"]);
});

test("Git metadata works when source directory is nested and has spaces", (t) => {
  const { root, put } = fixture(t);
  const app = path.join(root, "application source");
  fs.mkdirSync(app);
  put("application source/app.mjs", "nested app");
  git(root, ["init", "-q"]); git(root, ["config", "user.name", "Fixture"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["add", "."]); git(root, ["commit", "-qm", "fixture"]);
  assert.equal(sourceFingerprint(app).gitDirty, false);
  assert.deepEqual(sourceFingerprint(app).trackedSourcePaths, ["app.mjs"]);
  put("application source/app.mjs", "nested changed");
  assert.equal(sourceFingerprint(app).gitDirty, true);
});

test("non-Git export is explicitly inapplicable and launch correspondence is measured only on disk", (t) => {
  const { root } = fixture(t);
  const result = sourceFingerprint(root);
  assert.equal(result.gitRevision, null);
  assert.equal(result.gitDirty, null);
  assert.equal(result.gitApplicability, "unavailable");
  assert.equal(result.ampLaunchPath, "vendor/amp/dist/index.js");
  assert.equal(result.ampLaunchCorrespondence, "on-disk-only");
});

test("actual launcher executes fingerprinted source adapter, never runtime cache adapter", (t) => {
  const { root, put } = fixture(t);
  for (const name of ["mcp-launch.mjs", "owner-authority.mjs"]) fs.copyFileSync(new URL("../" + name, import.meta.url), path.join(root, name));
  put("vendor/amp/dist/index.js", "console.log('from-source');");
  put("runtime/cache/mcp/amp/dist/index.js", "console.log('WRONG_RUNTIME_CACHE');");
  put("runtime/config/secrets/mcp.json", JSON.stringify({ amp: { env: {} } }));
  const result = spawnSync(process.execPath, [path.join(root, "mcp-launch.mjs"), "amp"], { env: { ...process.env, PHUNBOT_ROOT: path.join(root, "runtime") }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "from-source");
  const identity = sourceFingerprint(root);
  assert.ok(identity.ampRuntimeFiles[identity.ampLaunchPath]);
});

test("health retains startup fields and reports actual changed-on-disk drift", async (t) => {
  const { root } = fixture(t);
  const sourceDir = fileURLToPath(new URL("..", import.meta.url));
  for (const name of fs.readdirSync(sourceDir)) {
    if (/\.(?:mjs|js|css|html)$/.test(name) || name === "package.json")
      fs.copyFileSync(path.join(sourceDir, name), path.join(root, name));
  }
  fs.symlinkSync(path.join(sourceDir, "node_modules"), path.join(root, "node_modules"));
  const { start } = await import(pathToFileURL(path.join(root, "app.mjs")));
  const server = await start({ root: path.join(root, "runtime"), token: "fixture", port: 0 });
  try {
    const health = async () => (await fetch(`http://127.0.0.1:${server.address().port}/health`)).json();
    const before = await health();
    assert.match(before.startupSourceSha256, /^[a-f0-9]{64}$/);
    assert.equal(before.sourceDrifted, false);
    fs.appendFileSync(path.join(root, "controller.mjs"), "\n// controlled on-disk drift\n");
    const after = await health();
    assert.equal(after.sourceDrifted, true);
    assert.equal(after.startupSourceSha256, before.startupSourceSha256);
    assert.deepEqual(after.startupSourceFiles, before.startupSourceFiles);
    assert.notEqual(after.currentSourceSha256, before.currentSourceSha256);
    fs.symlinkSync(path.join(root, "app.mjs"), path.join(root, "linked.mjs"));
    const unsafe = await health();
    assert.equal(unsafe.ok, false);
    assert.equal(unsafe.sourceVerification, "unavailable");
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
