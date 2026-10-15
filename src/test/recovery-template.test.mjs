import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const workflow = () => JSON.parse(fs.readFileSync(new URL("../../config/n8n-workflow.template.json", import.meta.url)));
test("published recovery template is inactive and omits exported private state", () => {
  const w = workflow();
  assert.equal(w.active, false);
  for (const field of ["id", "shared", "activeVersion", "staticData", "createdAt", "updatedAt", "versionId", "activeVersionId"]) assert.equal(field in w, false, field);
  assert.doesNotMatch(JSON.stringify(w), /phunraid|@gmail|WAITING_FOR_OWNER_RELOAD/);
});
test("candidate recovery requires exact startup/current source, revision and adapter identities", () => {
  const w = workflow();
  const code = w.nodes.find((n) => n.name === "Require reviewed revision").parameters.jsCode;
  const expected = { expectedGitRevision: "a".repeat(40), expectedSourceSha256: "b".repeat(64), expectedAmpRuntimeSha256: "c".repeat(64) };
  const h = { ok: true, name: "phunbot", sourceVerification: "available", sourceDrifted: false,
    startupGitRevision: expected.expectedGitRevision, currentGitRevision: expected.expectedGitRevision,
    startupGitDirty: false, currentGitDirty: false,
    startupSourceSha256: expected.expectedSourceSha256, currentSourceSha256: expected.expectedSourceSha256,
    startupAmpRuntimeSha256: expected.expectedAmpRuntimeSha256, currentAmpRuntimeSha256: expected.expectedAmpRuntimeSha256,
    ampLaunchCorrespondence: "on-disk-only" };
  const run = (health, cfg = expected) => vm.runInNewContext(`(function(){${code}})()`, {
    $input: { first: () => ({ json: health }), all: () => [{ json: health }] },
    $: () => ({ first: () => ({ json: cfg }) }),
  });
  assert.equal(run(h)[0].json, h);
  assert.throws(() => run(h, {}), /identity/);
  for (const key of ["startupSourceSha256", "currentSourceSha256", "startupGitRevision", "currentGitRevision", "startupAmpRuntimeSha256", "currentAmpRuntimeSha256"]) assert.throws(() => run({ ...h, [key]: "mismatch" }), /identity/);
  assert.throws(() => run({ ...h, sourceDrifted: true }), /identity/);
});
