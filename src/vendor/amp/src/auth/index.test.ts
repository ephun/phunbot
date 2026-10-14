import { describe, expect, it } from "vitest";
import { loadAuthConfigFromEnv } from "./index.js";

describe("loadAuthConfigFromEnv", () => {
  it("defaults to mode 'none' when MCP_AUTH_MODE is unset", async () => {
    const cfg = await loadAuthConfigFromEnv({});
    expect(cfg).toEqual({ mode: "none" });
  });

  it("returns 'none' when MCP_AUTH_MODE=none", async () => {
    const cfg = await loadAuthConfigFromEnv({ MCP_AUTH_MODE: "none" });
    expect(cfg.mode).toBe("none");
  });

  it("rejects bearer mode with no token", async () => {
    await expect(
      loadAuthConfigFromEnv({ MCP_AUTH_MODE: "bearer" }),
    ).rejects.toThrow(/MCP_AUTH_TOKEN/);
  });

  it("rejects bearer mode with empty token CSV", async () => {
    await expect(
      loadAuthConfigFromEnv({ MCP_AUTH_MODE: "bearer", MCP_AUTH_TOKEN: "  ,  ," }),
    ).rejects.toThrow(/MCP_AUTH_TOKEN/);
  });

  it("parses bearer token CSV and trims entries", async () => {
    const cfg = await loadAuthConfigFromEnv({
      MCP_AUTH_MODE: "bearer",
      MCP_AUTH_TOKEN: "alpha, beta ,gamma",
    });
    expect(cfg).toEqual({ mode: "bearer", tokens: ["alpha", "beta", "gamma"] });
  });

  it("rejects oauth mode without MCP_PUBLIC_URL", async () => {
    await expect(
      loadAuthConfigFromEnv({
        MCP_AUTH_MODE: "oauth",
        MCP_OAUTH_ISSUER: "https://auth.example.com",
      }),
    ).rejects.toThrow(/MCP_PUBLIC_URL/);
  });

  it("rejects oauth mode without MCP_OAUTH_ISSUER", async () => {
    await expect(
      loadAuthConfigFromEnv({
        MCP_AUTH_MODE: "oauth",
        MCP_PUBLIC_URL: "https://amp-mcp.example.com",
      }),
    ).rejects.toThrow(/MCP_OAUTH_ISSUER/);
  });

  it("uses MCP_OAUTH_JWKS_URL directly when provided (no discovery)", async () => {
    const cfg = await loadAuthConfigFromEnv({
      MCP_AUTH_MODE: "oauth",
      MCP_PUBLIC_URL: "https://amp-mcp.example.com",
      MCP_OAUTH_ISSUER: "https://auth.example.com",
      MCP_OAUTH_JWKS_URL: "https://auth.example.com/jwks",
      MCP_OAUTH_REQUIRED_SCOPES: "mcp:read,mcp:write",
    });
    expect(cfg).toMatchObject({
      mode: "oauth",
      publicUrl: "https://amp-mcp.example.com",
      issuer: "https://auth.example.com",
      audience: "https://amp-mcp.example.com",
      jwksUrl: "https://auth.example.com/jwks",
      requiredScopes: ["mcp:read", "mcp:write"],
    });
  });

  it("audience defaults to publicUrl when not overridden", async () => {
    const cfg = await loadAuthConfigFromEnv({
      MCP_AUTH_MODE: "oauth",
      MCP_PUBLIC_URL: "https://amp-mcp.example.com",
      MCP_OAUTH_ISSUER: "https://auth.example.com",
      MCP_OAUTH_JWKS_URL: "https://auth.example.com/jwks",
    });
    if (cfg.mode !== "oauth") throw new Error("expected oauth mode");
    expect(cfg.audience).toBe("https://amp-mcp.example.com");
  });

  it("respects MCP_OAUTH_AUDIENCE override", async () => {
    const cfg = await loadAuthConfigFromEnv({
      MCP_AUTH_MODE: "oauth",
      MCP_PUBLIC_URL: "https://amp-mcp.example.com",
      MCP_OAUTH_ISSUER: "https://auth.example.com",
      MCP_OAUTH_JWKS_URL: "https://auth.example.com/jwks",
      MCP_OAUTH_AUDIENCE: "amp-mcp",
    });
    if (cfg.mode !== "oauth") throw new Error("expected oauth mode");
    expect(cfg.audience).toBe("amp-mcp");
  });
});
