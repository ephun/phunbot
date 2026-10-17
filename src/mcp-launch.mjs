import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { secureAmpTransport } from "./owner-authority.mjs";
const root = process.env.PHUNBOT_ROOT || "/data";
const server = process.argv[2];
if (!["amp", "unraid"].includes(server)) throw Error("Unrecognized MCP server");
const settings = JSON.parse(fs.readFileSync(root + "/config/secrets/mcp.json"));
const env = { ...process.env, ...settings[server].env };
let executable, args;
if (server === "amp") {
  executable = process.execPath;
  // The reviewed adapter build belongs to the application checkout, not a
  // separately mutable runtime-cache implementation.
  args = [fileURLToPath(new URL("./vendor/amp/dist/index.js", import.meta.url))];
  env.MCP_TRANSPORT = "stdio";
  env.LOG_LEVEL = "error";
  const policyFile = root + "/config/permissions.json";
  const policy = fs.existsSync(policyFile)
    ? JSON.parse(fs.readFileSync(policyFile, "utf8"))
    : { ampManagement: false };
  env.AMP_ALLOW_WRITES =
    policy.ampManagement === true &&
    secureAmpTransport(env.AMP_URL)
      ? "true"
      : "false";
  env.AMP_MCP_UPLOAD_ROOTS = root + "/work";
} else {
  executable = root + "/bin/uv";
  args = [
    "tool",
    "run",
    "--python",
    "3.13",
    "--from",
    "unraid-mcp==2.10.2",
    "unraid-mcp",
  ];
  Object.assign(env, {
    UNRAID_MCP_TRANSPORT: "stdio",
    UNRAID_MCP_LOG_FILE: root + "/state/unraid-mcp.log",
    UV_CACHE_DIR: root + "/cache/uv",
    UV_PYTHON_INSTALL_DIR: root + "/cache/python",
    UV_PYTHON_PREFERENCE: "only-managed",
    UV_PYTHON_DOWNLOADS: "automatic",
    UV_NO_PROGRESS: "1",
    FASTMCP_SHOW_SERVER_BANNER: "false",
    FASTMCP_CHECK_FOR_UPDATES: "off",
  });
}
const child = spawn(executable, args, { env, stdio: "inherit" });
child.on("error", () => {
  console.error(server + " MCP failed to launch");
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
