import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AmpClient } from "./amp-client.js";
import { registerInstanceTools } from "./tools/instances.js";
import { registerConsoleTools } from "./tools/console.js";
import { registerOperationsTools } from "./tools/operations.js";
import { registerFileTools } from "./tools/files.js";
import type { Logger } from "./logger.js";

// Read package.json once at startup so the advertised version doesn't drift.
// Resolved via import.meta.url so it works whether invoked from src/ or dist/.
const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name: string; version: string };
export const SERVER_INFO = { name: pkg.name, version: pkg.version };

export function buildServer(amp: AmpClient, log: Logger, allowWrites: boolean): McpServer {
  const server = new McpServer(SERVER_INFO);
  registerInstanceTools(server, amp, log, allowWrites);
  registerConsoleTools(server, amp, log, allowWrites);
  registerOperationsTools(server, amp, log, allowWrites);
  registerFileTools(server, amp, log, allowWrites);
  return server;
}
