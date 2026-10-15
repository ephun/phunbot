import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Permissions } from "../permissions.mjs";
import { runOwnerCommand } from "../owner-cli.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-owner-cli-"));
  let goal = {
    id: "goal",
    kind: "goal",
    status: "NEEDS-ACTION",
    request: "Manage the disposable test instance",
  };
  const nc = {
    get: async () => structuredClone(goal),
    put: async (g) => (goal = structuredClone(g)),
    list: async () => [structuredClone(goal)],
  };
  fs.mkdirSync(root+'/config/secrets',{recursive:true});
  fs.writeFileSync(root+'/config/secrets/mcp.json',JSON.stringify({amp:{env:{AMP_URL:'https://amp.example.invalid'}}}));
  const p = new Permissions(nc, { record() {} }, { root, policy:{ampManagement:true} });
  return { root, nc, p, goal: () => goal };
}

test("local owner CLI initializes independent authority and approves one exact pending operation", async () => {
  const { root, nc, p, goal } = fixture();
  await runOwnerCommand(root, ["init"], { ncClient: nc });
  const args = { instanceId: "disposable" };
  const pending = await p.check("mcp__amp__amp_restart_instance", args, "goal");
  await runOwnerCommand(root, ["approve", "goal", pending.requestId], {
    ncClient: nc,
  });
  assert.equal(goal().authorizations[0].state, "approved");
  assert.equal(
    (await p.check("mcp__amp__amp_restart_instance", args, "goal")).allowed,
    true,
  );
  assert.equal(
    (await p.check("mcp__amp__amp_restart_instance", args, "goal")).allowed,
    false,
  );
});

test("local owner CLI refuses sensitive approval without an explicit acknowledgement", async () => {
  const { root, nc, p, goal } = fixture();
  await runOwnerCommand(root, ["init"], { ncClient: nc });
  const pending = await p.check(
    "mcp__amp__amp_restore_backup",
    { instanceId: "disposable", backupId: "fixture" },
    "goal",
  );
  await assert.rejects(
    () =>
      runOwnerCommand(root, ["approve", "goal", pending.requestId], {
        ncClient: nc,
      }),
    /acknowledg/i,
  );
  assert.equal(goal().authorizations[0].state, "pending");
  await runOwnerCommand(
    root,
    ["approve", "goal", pending.requestId, "--ack-sensitive"],
    { ncClient: nc },
  );
  assert.equal(goal().authorizations[0].state, "approved");
});
