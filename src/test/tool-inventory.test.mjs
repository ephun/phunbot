import { test } from "node:test";
import assert from "node:assert/strict";
import * as permissions from "../permissions.mjs";
test("tool inventory projects only actual registered capabilities and states independent operational gates", () => {
  assert.equal(typeof permissions.capabilityInventory, "function");
  const tools = permissions.capabilityInventory([
    { name: "read", description: "Read" },
    { name: "bash", description: "Shell" },
    { name: "mcp__amp__amp_restart_instance", description: "Restart" },
    { name: "mcp__amp__amp_get_instance_status", description: "Status" },
  ]);
  assert.equal(tools.length, 4);
  assert.equal(tools.find((t) => t.name === "bash").authorization, "denied");
  assert.equal(
    tools.find((t) => t.name.endsWith("amp_restart_instance")).authorization,
    "authenticated_chat",
  );
  assert.equal(
    tools.find((t) => t.name.endsWith("amp_get_instance_status")).authorization,
    "scoped_routine",
  );
  assert.equal(
    tools.some((t) => t.name.endsWith("amp_restore_backup")),
    false,
  );
  assert.deepEqual(permissions.capabilityInventory([]), []);
});
