import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import pino from "pino";
import { createBearerMiddleware } from "./bearer.js";

const silentLog = pino({ level: "silent" });

function makeApp(tokens: string[]) {
  const app = express();
  app.use(createBearerMiddleware({ mode: "bearer", tokens }, silentLog));
  app.post("/mcp", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("createBearerMiddleware", () => {
  const app = makeApp(["good-token", "alt-token"]);

  it("rejects requests with no Authorization header", async () => {
    const res = await request(app).post("/mcp");
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toContain("Bearer");
    expect(res.body.error.message).toMatch(/missing bearer token/i);
  });

  it("rejects non-Bearer schemes", async () => {
    const res = await request(app).post("/mcp").set("Authorization", "Basic Zm9vOmJhcg==");
    expect(res.status).toBe(401);
  });

  it("rejects an invalid token", async () => {
    const res = await request(app).post("/mcp").set("Authorization", "Bearer wrong");
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toContain('error="invalid_token"');
  });

  it("accepts a valid token", async () => {
    const res = await request(app).post("/mcp").set("Authorization", "Bearer good-token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("accepts any token from the configured list", async () => {
    const res = await request(app).post("/mcp").set("Authorization", "Bearer alt-token");
    expect(res.status).toBe(200);
  });

  it("rejects a token of the same length as a valid one (timing-safe path)", async () => {
    const res = await request(app).post("/mcp").set("Authorization", "Bearer xxxx-token");
    expect(res.status).toBe(401);
  });
});
