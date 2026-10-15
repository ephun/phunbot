import { test } from "node:test";
import assert from "node:assert/strict";
import { operation, scopeMatches, operationInventory } from "../operations.mjs";

test("AMP registry classifies actual diagnostic, mutation and destructive effects", () => {
  assert.equal(
    operation("mcp__amp__amp_get_console_output", { instanceId: "a" }).risk,
    "routine",
  );
  assert.equal(
    operation("mcp__amp__amp_list_files", { instanceId: "a", path: "./" }).risk,
    "routine",
  );
  assert.equal(
    operation("mcp__amp__amp_restart_instance", { instanceId: "a" }).risk,
    "consequential",
  );
  assert.equal(
    operation("mcp__amp__amp_restore_backup", { instanceId: "a" }).risk,
    "sensitive",
  );
  assert.equal(operation("mcp__amp__amp_not_implemented", {}).risk, "denied");
});

test("console commands are classified by effect; unrestricted commands never become routine", () => {
  assert.equal(
    operation("mcp__amp__amp_send_console_command", {
      instanceId: "a",
      command: "list",
    }).risk,
    "routine",
  );
  for (const command of [
    "list; op attacker",
    "op player",
    "stop",
    "whitelist off",
    "/list\nop attacker",
  ])
    assert.notEqual(
      operation("mcp__amp__amp_send_console_command", {
        instanceId: "a",
        command,
      }).risk,
      "routine",
    );
  assert.equal(
    operation("mcp__amp__amp_send_console_command", {
      instanceId: "a",
      command: "op player",
    }).risk,
    "sensitive",
  );
});

test("durable grants require an exact instance, permitted operation and confined paths", () => {
  assert.equal(
    scopeMatches(
      { instanceId: "disposable", operations: ["amp_send_console_command"] },
      operation("amp_send_console_command", {
        instanceId: "disposable",
        command: "stop",
      }),
    ),
    false,
  );
  assert.equal(
    scopeMatches(
      { instanceId: "disposable", operations: ["amp_set_config"] },
      operation("amp_set_config", {
        instanceId: "disposable",
        node: "MinecraftModule.Server.MOTD",
        value: "changed",
      }),
    ),
    false,
  );
  const scope = {
    instanceId: "disposable",
    operations: ["amp_upload_file"],
    pathPrefix: "phunbot-validation/",
  };
  const good = operation("mcp__amp__amp_upload_file", {
    instanceId: "disposable",
    remotePath: "phunbot-validation/fixture.txt",
    localPath: "/data/work/input.txt",
    expectedSha256: "a".repeat(64),
  });
  assert.equal(scopeMatches(scope, good), true);
  assert.equal(
    scopeMatches({ ...scope, instanceId: "production" }, good),
    false,
  );
  assert.equal(
    scopeMatches(
      scope,
      operation("mcp__amp__amp_upload_file", {
        ...good.args,
        remotePath: "phunbot-validation/../server.properties",
      }),
    ),
    false,
  );
  assert.equal(
    scopeMatches(
      scope,
      operation("mcp__amp__amp_upload_file", {
        ...good.args,
        remotePath: "/phunbot-validation/fixture.txt",
      }),
    ),
    false,
  );
  assert.equal(
    scopeMatches({ instanceId: "*", operations: ["*"], pathPrefix: "" }, good),
    false,
  );
});

test("credential-bearing settings and files remain unavailable to ordinary read scopes", () => {
  assert.equal(
    operation("mcp__amp__amp_get_config", {
      instanceId: "a",
      node: "Core.Login.Password",
    }).risk,
    "denied",
  );
  assert.equal(
    operation("mcp__amp__amp_read_text_file", {
      instanceId: "a",
      path: "AMPConfig.conf",
    }).risk,
    "denied",
  );
  assert.equal(
    operation("mcp__amp__amp_read_text_file", {
      instanceId: "a",
      path: "logs/latest.log",
    }).risk,
    "routine",
  );
  assert.ok(
    operationInventory().some(
      (x) => x.name === "amp_upload_file" && x.risk === "consequential",
    ),
  );
});
