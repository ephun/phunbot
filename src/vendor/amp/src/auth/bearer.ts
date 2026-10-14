import { createHash, timingSafeEqual } from "node:crypto";
import type { Logger } from "../logger.js";
import type { AuthMiddleware, BearerAuthConfig } from "./types.js";
import { extractBearer } from "./shared.js";

const sha256 = (s: string): Buffer => createHash("sha256").update(s).digest();

function isAcceptedToken(received: string, accepted: string[]): boolean {
  const r = sha256(received);
  let ok = false;
  for (const t of accepted) {
    if (timingSafeEqual(r, sha256(t))) ok = true;
  }
  return ok;
}

export function createBearerMiddleware(
  config: BearerAuthConfig,
  log: Logger,
): AuthMiddleware {
  return (req, res, next) => {
    const token = extractBearer(req);
    if (!token) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="mcp"');
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized: missing bearer token" },
        id: null,
      });
      return;
    }
    if (!isAcceptedToken(token, config.tokens)) {
      log.warn({ ip: req.ip }, "bearer auth rejected");
      res.setHeader(
        "WWW-Authenticate",
        'Bearer realm="mcp", error="invalid_token"',
      );
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized: invalid bearer token" },
        id: null,
      });
      return;
    }
    next();
  };
}
