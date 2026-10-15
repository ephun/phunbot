import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { OwnerAuthority } from "../owner-authority.mjs";
// Exercise a copied launcher and adapter in an isolated application tree, never
// an alternate implementation under runtime cache storage.
function launcher(root) {
  const source = path.join(root, "application");
  fs.mkdirSync(source, { recursive: true });
  for (const name of ["mcp-launch.mjs", "owner-authority.mjs"]) {
    fs.copyFileSync(new URL("../" + name, import.meta.url), path.join(source, name));
  }
  return path.join(source, "mcp-launch.mjs");
}
test("central owner authority enables write registration without an adapter-level veto", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "launch-authorized-"));
  fs.mkdirSync(root + "/config/secrets", { recursive: true });
  fs.writeFileSync(
    root + "/config/secrets/mcp.json",
    JSON.stringify({
      amp: {
        env: { AMP_ALLOW_WRITES: "false", AMP_URL: "https://amp.example.test" },
      },
    }),
  );
  fs.writeFileSync(
    root + "/config/permissions.json",
    JSON.stringify({ ampManagement: true }),
  );
  new OwnerAuthority(root).initialize();
  fs.mkdirSync(root + "/application/vendor/amp/dist", { recursive: true });
  fs.writeFileSync(
    root + "/application/vendor/amp/dist/index.js",
    "console.log(JSON.stringify({allowWrites:process.env.AMP_ALLOW_WRITES}));",
  );
  const r = spawnSync(
    process.execPath,
    [launcher(root), "amp"],
    { env: { ...process.env, PHUNBOT_ROOT: root }, encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).allowWrites, "true");
});
test("owner key alone cannot enable privileged registration over plaintext LAN transport", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "launch-insecure-"));
  fs.mkdirSync(root + "/config/secrets", { recursive: true });
  fs.writeFileSync(
    root + "/config/secrets/mcp.json",
    JSON.stringify({ amp: { env: { AMP_URL: "http://192.0.2.10:8080" } } }),
  );
  fs.writeFileSync(
    root + "/config/permissions.json",
    JSON.stringify({ ampManagement: true }),
  );
  new OwnerAuthority(root).initialize();
  fs.mkdirSync(root + "/application/vendor/amp/dist", { recursive: true });
  fs.writeFileSync(
    root + "/application/vendor/amp/dist/index.js",
    "console.log(JSON.stringify({allowWrites:process.env.AMP_ALLOW_WRITES}));",
  );
  const r = spawnSync(
    process.execPath,
    [launcher(root), "amp"],
    { env: { ...process.env, PHUNBOT_ROOT: root }, encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).allowWrites, "false");
});
test("secure transport and an owner key do not substitute for explicit AMP management policy", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "launch-no-policy-"));
  fs.mkdirSync(root + "/config/secrets", { recursive: true });
  fs.writeFileSync(
    root + "/config/secrets/mcp.json",
    JSON.stringify({ amp: { env: { AMP_URL: "https://amp.example.test" } } }),
  );
  new OwnerAuthority(root).initialize();
  fs.mkdirSync(root + "/application/vendor/amp/dist", { recursive: true });
  fs.writeFileSync(
    root + "/application/vendor/amp/dist/index.js",
    "console.log(JSON.stringify({allowWrites:process.env.AMP_ALLOW_WRITES}));",
  );
  const r = spawnSync(
    process.execPath,
    [launcher(root), "amp"],
    { env: { ...process.env, PHUNBOT_ROOT: root }, encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).allowWrites, "false");
});
test("AMP launcher starts read-only unless an operator explicitly configures writes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "launch-"));
  fs.mkdirSync(root + "/config/secrets", { recursive: true });
  fs.writeFileSync(
    root + "/config/secrets/mcp.json",
    JSON.stringify({ amp: { env: {} } }),
  );
  fs.mkdirSync(root + "/application/vendor/amp/dist", { recursive: true });
  fs.writeFileSync(
    root + "/application/vendor/amp/dist/index.js",
    "console.log(JSON.stringify({allowWrites:process.env.AMP_ALLOW_WRITES}));",
  );
  const r = spawnSync(
    process.execPath,
    [launcher(root), "amp"],
    { env: { ...process.env, PHUNBOT_ROOT: root }, encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).allowWrites, "false");
});
test("Unraid launcher disables FastMCP update checks with the installed Settings literal", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "launch-unraid-"));
  fs.mkdirSync(root + "/config/secrets", { recursive: true });
  fs.mkdirSync(root + "/bin");
  fs.writeFileSync(
    root + "/config/secrets/mcp.json",
    JSON.stringify({ unraid: { env: {} } }),
  );
  fs.writeFileSync(
    root + "/bin/uv",
    "#!/usr/bin/env node\nconsole.log(JSON.stringify({updateChecks:process.env.FASTMCP_CHECK_FOR_UPDATES}));\n",
    { mode: 0o700 },
  );
  const result = spawnSync(
    process.execPath,
    [launcher(root), "unraid"],
    { env: { ...process.env, PHUNBOT_ROOT: root }, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).updateChecks, "off");
});
