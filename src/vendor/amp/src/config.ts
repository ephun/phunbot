import { z } from "zod";
import { loadAuthConfigFromEnv, type AuthConfig } from "./auth/index.js";

const envSchema = z
  .object({
    // AMP connection
    AMP_URL: z.string().url(),
    AMP_USERNAME: z.string().min(1),
    AMP_PASSWORD: z.string().min(1),
    AMP_ALLOW_WRITES: z.enum(["true", "false"]).default("false"),

    // Transport
    MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),

    // HTTP transport
    MCP_PORT: z.coerce.number().int().positive().default(3000),
    MCP_HOST: z.string().default("127.0.0.1"),
    MCP_ALLOWED_HOSTS: z.string().optional(),
    MCP_ALLOWED_ORIGINS: z.string().optional(),
    MCP_TRUST_PROXY: z.string().optional(),
    MCP_ALLOW_INSECURE: z.enum(["true", "false"]).default("false"),
    MCP_RATE_LIMIT: z.coerce.number().int().nonnegative().default(120),
    MCP_RATE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  })
  .passthrough();

const csv = (s: string | undefined): string[] =>
  s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];

export interface AmpConfig {
  baseUri: string;
  username: string;
  password: string;
  allowWrites: boolean;
}

export interface HttpConfig {
  host: string;
  port: number;
  allowedHosts: string[];
  allowedOrigins: string[];
  trustProxy: string | undefined;
  allowInsecure: boolean;
  rateLimit: { max: number; windowMs: number };
  auth: AuthConfig;
}

export interface AppConfig {
  amp: AmpConfig;
  transport: "stdio" | "http";
  http: HttpConfig;
}

/**
 * Parse and validate the entire process environment in one place. Auth
 * config still lives in auth/index.ts (it's its own discriminated union
 * with async OIDC discovery) — we just orchestrate the call here.
 */
export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<AppConfig> {
  const parsed = envSchema.parse(env);
  const auth = await loadAuthConfigFromEnv(env);
  return {
    amp: {
      baseUri: parsed.AMP_URL,
      username: parsed.AMP_USERNAME,
      password: parsed.AMP_PASSWORD,
      allowWrites: parsed.AMP_ALLOW_WRITES === "true",
    },
    transport: parsed.MCP_TRANSPORT,
    http: {
      host: parsed.MCP_HOST,
      port: parsed.MCP_PORT,
      allowedHosts: csv(parsed.MCP_ALLOWED_HOSTS),
      allowedOrigins: csv(parsed.MCP_ALLOWED_ORIGINS),
      trustProxy: parsed.MCP_TRUST_PROXY,
      allowInsecure: parsed.MCP_ALLOW_INSECURE === "true",
      rateLimit: { max: parsed.MCP_RATE_LIMIT, windowMs: parsed.MCP_RATE_WINDOW_MS },
      auth,
    },
  };
}
