import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import express from "express";
import request from "supertest";
import pino from "pino";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import { createOAuthMiddleware } from "./oauth.js";

const silentLog = pino({ level: "silent" });

const ISSUER = "https://auth.example.test";
const AUDIENCE = "https://amp-mcp.example.test";
const PUBLIC_URL = AUDIENCE;

let signingKey: CryptoKey;
let publicJwk: JWK;
let jwksServer: Server;
let jwksUrl: string;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  signingKey = privateKey;
  publicJwk = { ...(await exportJWK(publicKey)), kid: "test-1", alg: "RS256", use: "sig" };

  // Local HTTP server to serve the JWKS — much more reliable than stubbing
  // global fetch (jose may capture references in ways that bypass stubs).
  jwksServer = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise<void>((resolve) => jwksServer.listen(0, "127.0.0.1", resolve));
  const addr = jwksServer.address() as AddressInfo;
  jwksUrl = `http://127.0.0.1:${addr.port}/jwks`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    jwksServer.close((err) => (err ? reject(err) : resolve())),
  );
});

async function mintToken(claims: {
  iss?: string;
  aud?: string;
  sub?: string;
  scope?: string;
  exp?: number;
}): Promise<string> {
  const jwt = new SignJWT({ scope: claims.scope ?? "mcp:read" })
    .setProtectedHeader({ alg: "RS256", kid: "test-1" })
    .setIssuer(claims.iss ?? ISSUER)
    .setAudience(claims.aud ?? AUDIENCE)
    .setSubject(claims.sub ?? "user-123")
    .setIssuedAt();
  if (claims.exp !== undefined) {
    jwt.setExpirationTime(claims.exp);
  } else {
    jwt.setExpirationTime("5m");
  }
  return jwt.sign(signingKey);
}

function makeApp(requiredScopes: string[] = []) {
  const app = express();
  app.use(
    createOAuthMiddleware(
      {
        mode: "oauth",
        publicUrl: PUBLIC_URL,
        issuer: ISSUER,
        audience: AUDIENCE,
        jwksUrl,
        requiredScopes,
      },
      silentLog,
    ),
  );
  app.post("/mcp", (_req, res) => {
    res.json({ ok: true, sub: res.locals.auth?.sub });
  });
  return app;
}

describe("createOAuthMiddleware", () => {
  it("accepts a valid token", async () => {
    const app = makeApp();
    const token = await mintToken({});
    const res = await request(app).post("/mcp").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, sub: "user-123" });
  });

  it("rejects missing token with 401 + WWW-Authenticate including resource_metadata", async () => {
    const app = makeApp();
    const res = await request(app).post("/mcp");
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toContain("Bearer");
    expect(res.headers["www-authenticate"]).toContain("resource_metadata=");
  });

  it("rejects wrong issuer", async () => {
    const app = makeApp();
    const token = await mintToken({ iss: "https://evil.example.test" });
    const res = await request(app).post("/mcp").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toContain('error="invalid_token"');
  });

  it("rejects wrong audience", async () => {
    const app = makeApp();
    const token = await mintToken({ aud: "https://other.example.test" });
    const res = await request(app).post("/mcp").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("rejects expired tokens", async () => {
    const app = makeApp();
    const token = await mintToken({ exp: Math.floor(Date.now() / 1000) - 60 });
    const res = await request(app).post("/mcp").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("rejects when required scopes are missing (403 insufficient_scope)", async () => {
    const app = makeApp(["mcp:write"]);
    const token = await mintToken({ scope: "mcp:read" });
    const res = await request(app).post("/mcp").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.headers["www-authenticate"]).toContain('error="insufficient_scope"');
    expect(res.body.error.message).toMatch(/missing required scope/);
  });

  it("accepts when all required scopes are present", async () => {
    const app = makeApp(["mcp:read", "mcp:write"]);
    const token = await mintToken({ scope: "mcp:read mcp:write extra" });
    const res = await request(app).post("/mcp").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
