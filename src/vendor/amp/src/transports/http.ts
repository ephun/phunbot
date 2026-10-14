import { randomUUID } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import rateLimit from "express-rate-limit";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AmpClient } from "../amp-client.js";
import { createAuthMiddleware, mountAuthRoutes } from "../auth/index.js";
import type { AppConfig, HttpConfig } from "../config.js";
import { logger } from "../logger.js";
import { buildServer } from "../server.js";

const ANY_HOSTS = new Set(["0.0.0.0", "::"]);

// Origin header validation. MCP HTTP transport spec calls for explicit
// Origin checks on POSTs from browser-based clients. Allow same-origin /
// no-origin (server-to-server, CLI) requests through; reject mismatches
// when an allow-list is configured.
function originValidation(allowed: string[]): RequestHandler {
  if (allowed.length === 0) return (_req, _res, next) => next();
  const set = new Set(allowed);
  return (req, res, next) => {
    const origin = req.header("origin");
    if (!origin || set.has(origin)) {
      next();
      return;
    }
    res.status(403).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Forbidden: origin not allowed" },
      id: null,
    });
  };
}

function buildRateLimiter(cfg: HttpConfig["rateLimit"]): RequestHandler {
  if (cfg.max <= 0) return (_req, _res, next) => next();
  return rateLimit({
    windowMs: cfg.windowMs,
    limit: cfg.max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Too many requests" },
      id: null,
    },
  });
}

function assertSafeBinding(http: HttpConfig): void {
  if (
    ANY_HOSTS.has(http.host) &&
    http.auth.mode === "none" &&
    http.allowedHosts.length === 0 &&
    !http.allowInsecure
  ) {
    logger.fatal(
      { host: http.host },
      "refusing to start: MCP_HOST binds to all interfaces with MCP_AUTH_MODE=none and no MCP_ALLOWED_HOSTS. Set MCP_AUTH_MODE=bearer|oauth, restrict MCP_HOST to 127.0.0.1, set MCP_ALLOWED_HOSTS, or override with MCP_ALLOW_INSECURE=true.",
    );
    process.exit(1);
  }
}

export async function startHttp(amp: AmpClient, config: AppConfig): Promise<void> {
  const http = config.http;
  assertSafeBinding(http);

  const app = createMcpExpressApp(
    http.allowedHosts.length > 0
      ? { host: http.host, allowedHosts: http.allowedHosts }
      : { host: http.host },
  );

  if (http.trustProxy) {
    app.set("trust proxy", http.trustProxy);
  }

  logger.info({ authMode: http.auth.mode }, "auth configured");
  mountAuthRoutes(app, http.auth);

  const authMiddleware = createAuthMiddleware(http.auth, logger);
  const originMiddleware = originValidation(http.allowedOrigins);
  const limiterMiddleware = buildRateLimiter(http.rateLimit);
  const allowWrites = config.amp.allowWrites;

  // Liveness probe. Mounted before the /mcp middleware chain so it's not
  // gated by auth, origin, or rate limiting — Docker/k8s healthchecks need
  // to reach it without any of that. Liveness only: confirms the process is
  // responsive, does NOT check downstream AMP connectivity.
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  app.post("/mcp", limiterMiddleware, originMiddleware, authMiddleware, async (req: Request, res: Response) => {
    const reqId = randomUUID();
    const sub = (res.locals as { auth?: { sub?: string } }).auth?.sub;
    const reqLog = logger.child(sub ? { reqId, sub } : { reqId });
    reqLog.debug("incoming /mcp POST");
    const server = buildServer(amp, reqLog, allowWrites);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    // Cleanup MUST be wired up before any operation that can throw, so we
    // don't leak the transport/server when handleRequest or connect fails.
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      void transport.close();
      void server.close();
    };
    res.on("close", cleanup);

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      reqLog.error({ err }, "error handling /mcp request");
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
      cleanup();
    }
  });

  const reject405 = (_req: Request, res: Response): void => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method Not Allowed (stateless mode)" },
      id: null,
    });
  };
  app.get("/mcp", reject405);
  app.delete("/mcp", reject405);

  const httpServer = app.listen(http.port, http.host, () => {
    logger.info(
      { host: http.host, port: http.port, url: `http://${http.host}:${http.port}/mcp` },
      "HTTP transport listening",
    );
  });

  // Graceful shutdown: stop accepting new connections, let in-flight finish.
  // SIGTERM = container stop; SIGINT = Ctrl-C.
  const shutdown = (sig: string): void => {
    logger.info({ sig }, "shutdown signal received");
    httpServer.close((err) => {
      if (err) {
        logger.error({ err }, "error during HTTP server close");
        process.exit(1);
      }
      process.exit(0);
    });
    // Hard timeout so we don't hang forever on a stuck connection.
    setTimeout(() => {
      logger.warn("graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, 10_000).unref();
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}
