import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Memory } from "../memory.mjs";
import { consolidateSessions } from "../retrospective.mjs";

// These are deliberately synthetic, unusable format fixtures, never credentials.
const fixtures = [
  "ghp_" + "a".repeat(36),
  "github_pat_" + "b".repeat(50),
  "AKIA" + "A".repeat(16),
  "-----BEGIN PRIVATE KEY-----\n" +
    "x".repeat(40) +
    "\n-----END PRIVATE KEY-----",
  Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url") +
    "." +
    Buffer.from('{"sub":"fixture"}').toString("base64url") +
    "." +
    "x".repeat(32),
  "postgresql://fixture:synthetic-pass@database.example.test/service",
  "Bearer " + "x".repeat(24),
  "api_key: " + "x".repeat(24),
];
test("common credential formats are refused before any note or revision is stored", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-credentials-"));
  const memory = new Memory(root);
  for (const fixture of fixtures)
    assert.throws(
      () =>
        memory.put(
          "credential",
          "Credential",
          "A reusable observation that contains " + fixture,
          "synthetic fixture",
        ),
      /secret|credential/i,
    );
  assert.equal(memory.list().length, 0);
  assert.deepEqual(fs.readdirSync(root + "/state/memory-revisions"), []);
});
test("credential-bearing source records never reach the retrospective model reviewer", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "learning-credentials-"));
  const memory = new Memory(root);
  let reviews = 0;
  await consolidateSessions(
    root,
    memory,
    [
      {
        id: "secret-source",
        entries: fixtures.map((text, index) => ({
          id: "entry-" + index,
          type: "message",
          message: { role: "user", content: "Important context with " + text },
        })),
      },
    ],
    async () => {
      reviews++;
      return { observations: [] };
    },
  );
  assert.equal(reviews, 0);
  assert.equal(memory.list().length, 0);
});
