import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OwnerAuthority, secureAmpTransport } from "../owner-authority.mjs";
test("privileged AMP transport rejects plaintext LAN and embedded credentials", () => {
  assert.equal(secureAmpTransport("http://amp.example.invalid:8080"), false);
  assert.equal(secureAmpTransport("https://amp.example.test"), true);
  assert.equal(secureAmpTransport("http://127.0.0.1:8080"), true);
  assert.equal(
    secureAmpTransport("https://user:password@amp.example.test"),
    false,
  );
});

test("transport permits only HTTP loopback or credential-free HTTPS URLs", () => {
  for (const url of [
    "https://user:password@amp.local",
    "http://user:password@127.0.0.1:8080",
    "ftp://127.0.0.1:8080",
    "file:///tmp/amp",
  ])
    assert.equal(secureAmpTransport(url), false, url);
  assert.equal(secureAmpTransport("https://amp.example.invalid:8443"), true);
});

test("ordinary chat bearer material cannot grant an independently signed owner decision", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-owner-"));
  const owner = new OwnerAuthority(root);
  assert.equal(owner.available(), false);
  assert.equal(
    owner.verify({
      kind: "exact",
      goalId: "g",
      requestId: "r",
      hash: "operation",
      expiresAt: Date.now() + 1000,
      signature: "ordinary-chat-bearer",
    }),
    false,
  );
  owner.initialize();
  const decision = owner.sign({
    kind: "exact",
    goalId: "g",
    requestId: "r",
    hash: "operation",
    expiresAt: Date.now() + 60000,
  });
  assert.equal(owner.verify(decision), true);
  assert.equal(
    owner.verify({ ...decision, hash: "different-operation" }),
    false,
  );
  assert.equal(owner.verify({ ...decision, goalId: "other-goal" }), false);
  assert.equal(
    fs.statSync(root + "/config/secrets/owner-approval-key").mode & 0o777,
    0o600,
  );
});

test("expired grants and sensitive operations without stronger acknowledgement fail closed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-owner-"));
  const owner = new OwnerAuthority(root);
  owner.initialize();
  assert.equal(
    owner.verify(owner.sign({ kind: "exact", expiresAt: 100 }), 101),
    false,
  );
  assert.throws(
    () =>
      owner.sign({
        kind: "exact",
        risk: "sensitive",
        expiresAt: Date.now() + 1000,
      }),
    /acknowledg/i,
  );
  assert.equal(
    owner.verify(
      owner.sign({
        kind: "exact",
        risk: "sensitive",
        acknowledgedSensitive: true,
        expiresAt: Date.now() + 1000,
      }),
    ),
    true,
  );
});
