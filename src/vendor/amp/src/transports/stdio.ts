import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { AmpClient } from "../amp-client.js";
import type { AppConfig } from "../config.js";
import { logger } from "../logger.js";
import { buildServer } from "../server.js";

export async function startStdio(amp: AmpClient, config: AppConfig): Promise<void> {
  const server = buildServer(amp, logger, config.amp.allowWrites);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("stdio transport connected");
}
