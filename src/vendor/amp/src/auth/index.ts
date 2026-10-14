import { z } from "zod";
import type { Express } from "express";
import type { Logger } from "../logger.js";
import { createBearerMiddleware } from "./bearer.js";
import { createOAuthMiddleware, discoverJwksUrl, mountProtectedResourceMetadata } from "./oauth.js";
import type { AuthConfig, AuthMiddleware } from "./types.js";

export type { AuthConfig, AuthMiddleware, AuthMode } from "./types.js";

const csv = (s: string): string[] =>
  s.split(",").map((t) => t.trim()).filter(Boolean);

const envSchema = z
  .object({
    MCP_AUTH_MODE: z.enum(["none", "bearer", "oauth"]).default("none"),
    MCP_PUBLIC_URL: z.string().url().optional(),
    MCP_AUTH_TOKEN: z.string().optional(),
    MCP_OAUTH_ISSUER: z.string().url().optional(),
    MCP_OAUTH_AUDIENCE: z.string().optional(),
    MCP_OAUTH_JWKS_URL: z.string().url().optional(),
    MCP_OAUTH_REQUIRED_SCOPES: z.string().optional(),
  })
  .passthrough();

export async function loadAuthConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AuthConfig> {
  const parsed = envSchema.parse(env);

  if (parsed.MCP_AUTH_MODE === "none") {
    return { mode: "none" };
  }

  if (parsed.MCP_AUTH_MODE === "bearer") {
    const tokens = csv(parsed.MCP_AUTH_TOKEN ?? "");
    if (tokens.length === 0) {
      throw new Error(
        "amp-mcp-server: MCP_AUTH_MODE=bearer requires MCP_AUTH_TOKEN to be set (comma-separated for multiple tokens).",
      );
    }
    return { mode: "bearer", tokens };
  }

  // mode === "oauth"
  if (!parsed.MCP_PUBLIC_URL) {
    throw new Error(
      "amp-mcp-server: MCP_AUTH_MODE=oauth requires MCP_PUBLIC_URL (canonical external URL of this server, used as the resource identifier and JWT audience).",
    );
  }
  if (!parsed.MCP_OAUTH_ISSUER) {
    throw new Error(
      "amp-mcp-server: MCP_AUTH_MODE=oauth requires MCP_OAUTH_ISSUER (URL of your OAuth 2.1 authorization server).",
    );
  }

  const jwksUrl = parsed.MCP_OAUTH_JWKS_URL ?? (await discoverJwksUrl(parsed.MCP_OAUTH_ISSUER));

  return {
    mode: "oauth",
    publicUrl: parsed.MCP_PUBLIC_URL,
    issuer: parsed.MCP_OAUTH_ISSUER,
    audience: parsed.MCP_OAUTH_AUDIENCE ?? parsed.MCP_PUBLIC_URL,
    jwksUrl,
    requiredScopes: csv(parsed.MCP_OAUTH_REQUIRED_SCOPES ?? ""),
  };
}

export function createAuthMiddleware(config: AuthConfig, log: Logger): AuthMiddleware {
  switch (config.mode) {
    case "none":
      return (_req, _res, next) => next();
    case "bearer":
      return createBearerMiddleware(config, log);
    case "oauth":
      return createOAuthMiddleware(config, log);
  }
}

export function mountAuthRoutes(app: Express, config: AuthConfig): void {
  if (config.mode === "oauth") {
    mountProtectedResourceMetadata(app, config);
  }
}
