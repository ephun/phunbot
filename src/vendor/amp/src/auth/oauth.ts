import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Express } from "express";
import type { Logger } from "../logger.js";
import type { AuthMiddleware, OAuthAuthConfig } from "./types.js";
import { extractBearer } from "./shared.js";

export async function discoverJwksUrl(issuer: string): Promise<string> {
  const base = issuer.replace(/\/$/, "");
  const url = `${base}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `OIDC discovery failed for issuer ${issuer}: HTTP ${res.status}`,
    );
  }
  const doc = (await res.json()) as { jwks_uri?: string };
  if (!doc.jwks_uri) {
    throw new Error(
      `OIDC discovery document at ${url} did not contain jwks_uri`,
    );
  }
  return doc.jwks_uri;
}

function prmUrl(publicUrl: string): string {
  return `${publicUrl.replace(/\/$/, "")}/.well-known/oauth-protected-resource`;
}

// Strip double-quote and any control char (incl. CR/LF/tab) from a header
// value. Node's setHeader throws on CRLF, and a throw inside a 401 handler
// becomes a 500 — sanitize up front.
function sanitizeHeaderValue(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c < 0x20 || c === 0x22 ? " " : s[i];
  }
  return out;
}

function challenge(publicUrl: string, error?: string, description?: string): string {
  const parts = ['Bearer realm="mcp"'];
  if (error) parts.push(`error="${sanitizeHeaderValue(error)}"`);
  if (description) parts.push(`error_description="${sanitizeHeaderValue(description)}"`);
  parts.push(`resource_metadata="${prmUrl(publicUrl)}"`);
  return parts.join(", ");
}

function tokenScopes(payload: JWTPayload): string[] {
  const raw = payload["scope"] ?? payload["scp"];
  if (typeof raw === "string") return raw.split(/\s+/).filter(Boolean);
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === "string");
  return [];
}

export function mountProtectedResourceMetadata(
  app: Express,
  config: OAuthAuthConfig,
): void {
  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json({
      resource: config.publicUrl,
      authorization_servers: [config.issuer],
      bearer_methods_supported: ["header"],
      scopes_supported: config.requiredScopes,
    });
  });
}

export function createOAuthMiddleware(
  config: OAuthAuthConfig,
  log: Logger,
): AuthMiddleware {
  const jwks = createRemoteJWKSet(new URL(config.jwksUrl));

  return async (req, res, next) => {
    const token = extractBearer(req);
    if (!token) {
      res.setHeader("WWW-Authenticate", challenge(config.publicUrl));
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized: missing bearer token" },
        id: null,
      });
      return;
    }

    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: config.issuer,
        audience: config.audience,
      });

      if (config.requiredScopes.length > 0) {
        const have = new Set(tokenScopes(payload));
        const missing = config.requiredScopes.filter((s) => !have.has(s));
        if (missing.length > 0) {
          res.setHeader(
            "WWW-Authenticate",
            challenge(
              config.publicUrl,
              "insufficient_scope",
              `missing required scope(s): ${missing.join(" ")}`,
            ),
          );
          res.status(403).json({
            jsonrpc: "2.0",
            error: {
              code: -32001,
              message: `Forbidden: missing required scope(s): ${missing.join(" ")}`,
            },
            id: null,
          });
          return;
        }
      }

      res.locals.auth = { sub: payload.sub, scopes: tokenScopes(payload) };
      next();
    } catch (err) {
      const description = err instanceof Error ? err.message : "token verification failed";
      log.warn({ ip: req.ip, err }, "oauth token verification failed");
      res.setHeader(
        "WWW-Authenticate",
        challenge(config.publicUrl, "invalid_token", description),
      );
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized: invalid token" },
        id: null,
      });
    }
  };
}
