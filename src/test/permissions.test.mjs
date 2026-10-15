import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Permissions, classify } from "../permissions.mjs";

function fixture() {
  let goal = {
    id: "g",
    kind: "goal",
    status: "NEEDS-ACTION",
    request: "Diagnose and fix one server",
  };
  const nc = {
    get: async () => structuredClone(goal),
    put: async (value) => (goal = structuredClone(value)),
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-permissions-"));
  const events = [];
  const p = new Permissions(
    nc,
    { record: (...args) => events.push(args) },
    { root, policy: { ampManagement: true } },
  );
  p.owner.initialize();
  fs.mkdirSync(root + "/config/secrets", { recursive: true });
  fs.writeFileSync(
    root + "/config/secrets/mcp.json",
    JSON.stringify({
      amp: { env: { AMP_URL: "https://amp.example.invalid" } },
    }),
  );
  return { p, root, events, goal: () => goal };
}

test("ordinary browser approval cannot authorize a consequential effect", async () => {
  const { p, goal } = fixture();
  const pending = await p.check(
    "mcp__amp__amp_restart_instance",
    { instanceId: "fixture" },
    "g",
  );
  await assert.rejects(
    () => p.decide("g", pending.requestId, true),
    /independent|owner|signed/i,
  );
  assert.equal(goal().authorizations[0].state, "pending");
});

test("atomic memory and scoped AMP diagnostics are routine, but sensitive file access is denied", () => {
  assert.equal(classify("memory_observe", {}).mode, "read");
  assert.equal(classify("mcp__phunbot__memory_observe", {}).mode, "deny");
  assert.equal(classify("mcp__phunbot__memory_link", {}).mode, "read");
  assert.equal(
    classify("mcp__amp__amp_get_console_output", { instanceId: "fixture" })
      .mode,
    "read",
  );
  assert.equal(
    classify("mcp__amp__amp_list_files", { instanceId: "fixture", path: "./" })
      .mode,
    "read",
  );
  assert.equal(
    classify("mcp__amp__amp_read_text_file", {
      instanceId: "fixture",
      path: "AMPConfig.conf",
    }).mode,
    "deny",
  );
});

test("an explicit owner denial does not silently create the same request again", async () => {
  const { p, goal } = fixture();
  const args = { instanceId: "fixture" };
  const r = await p.check("mcp__amp__amp_restart_instance", args, "g");
  await p.decide("g", r.requestId, false);
  assert.equal(
    (await p.check("mcp__amp__amp_restart_instance", args, "g")).allowed,
    false,
  );
  assert.equal(goal().authorizations.length, 1);
  assert.equal(goal().authorizations[0].state, "denied");
});

test("consequential tools require exact independently signed one-use approval with readback", async () => {
  const { p, goal, events } = fixture();
  assert.equal(
    (await p.check("mcp__amp__amp_list_instances", {}, "g")).allowed,
    true,
  );
  const pending = await p.check(
    "mcp__amp__amp_restart_instance",
    { instanceId: "fixture-target" },
    "g",
  );
  assert.equal(pending.allowed, false);
  const item = goal().authorizations[0];
  const proof = p.owner.sign({
    kind: "exact",
    goalId: "g",
    requestId: item.id,
    hash: item.hash,
    risk: item.risk,
    expiresAt: Date.now() + 60000,
  });
  await p.decide("g", pending.requestId, true, proof);
  assert.equal(
    (
      await p.check(
        "mcp__amp__amp_restart_instance",
        { instanceId: "different-target" },
        "g",
      )
    ).allowed,
    false,
  );
  assert.equal(
    (
      await p.check(
        "mcp__amp__amp_restart_instance",
        { instanceId: "fixture-target" },
        "g",
      )
    ).allowed,
    true,
  );
  assert.equal(
    goal().authorizations.find((x) => x.id === pending.requestId).state,
    "consumed",
  );
  assert.equal(
    (
      await p.check(
        "mcp__amp__amp_restart_instance",
        { instanceId: "fixture-target" },
        "g",
      )
    ).allowed,
    false,
  );
  assert.equal(
    (
      await p.check(
        "mcp__unraid__unraid",
        { action: "docker", subaction: "list" },
        "g",
      )
    ).allowed,
    false,
  );
  assert.equal(
    (
      await p.check(
        "mcp__unraid__unraid",
        { action: "key", subaction: "list" },
        "g",
      )
    ).allowed,
    false,
  );
  assert.ok(events.length);
});

test("signed durable scope grants only the permitted operation, instance and confined artifact path", async () => {
  const { p, root } = fixture();
  const scope = p.owner.sign({
    kind: "scope",
    id: "fixture-scope",
    instanceId: "disposable",
    operations: ["amp_upload_file"],
    pathPrefix: "phunbot-validation/",
    expiresAt: Date.now() + 60000,
  });
  fs.writeFileSync(root + "/config/owner-scopes.json", JSON.stringify([scope]));
  const args = {
    instanceId: "disposable",
    remotePath: "phunbot-validation/a.txt",
    localPath: "/data/work/a.txt",
    expectedSha256: "a".repeat(64),
  };
  assert.equal(
    (await p.check("mcp__amp__amp_upload_file", args, "g")).allowed,
    true,
  );
  assert.equal(
    (
      await p.check(
        "mcp__amp__amp_upload_file",
        { ...args, instanceId: "production" },
        "g",
      )
    ).allowed,
    false,
  );
  assert.equal(
    (
      await p.check(
        "mcp__amp__amp_upload_file",
        { ...args, remotePath: "server.properties" },
        "g",
      )
    ).allowed,
    false,
  );
  assert.equal(
    (
      await p.check(
        "mcp__amp__amp_restore_backup",
        { instanceId: "disposable" },
        "g",
      )
    ).allowed,
    false,
  );
});
