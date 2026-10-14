#!/usr/bin/env node
import { AmpClient } from "./amp-client.js";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { startHttp } from "./transports/http.js";
import { startStdio } from "./transports/stdio.js";

async function main(): Promise<void> {
  const config = await loadConfig();
  const amp = new AmpClient(config.amp);

  switch (config.transport) {
    case "stdio":
      return startStdio(amp, config);
    case "http":
      return startHttp(amp, config);
  }
}

main().catch((err) => {
  logger.fatal({ err }, "fatal startup error");
  process.exit(1);
});
