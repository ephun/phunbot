import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { PendingRequests, secureRequestId } from "../request-identity.mjs";
const digest = (text) => createHash("sha256").update(text).digest("hex");
function storage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("an unacknowledged submission reuses its exact identity after reload without storing message bytes", () => {
  const store = storage(),
    namespace = digest("owner-fixture"),
    payload = { text: "A private draft with an intended outcome", images: [] };
  const first = new PendingRequests(store, namespace, digest).prepare(
    "conversation-one",
    payload,
  );
  const reloaded = new PendingRequests(store, namespace, digest),
    retry = reloaded.prepare("conversation-one", payload);
  assert.equal(retry.requestId, first.requestId);
  assert.ok(!JSON.stringify([...store.values]).includes(payload.text));
  assert.notEqual(
    reloaded.prepare("conversation-two", payload).requestId,
    first.requestId,
  );
  reloaded.acknowledge(retry);
  assert.notEqual(
    reloaded.prepare("conversation-one", payload).requestId,
    first.requestId,
  );
});
test("independent owner namespaces and changed input cannot silently amend a pending request", () => {
  const store = storage(),
    one = new PendingRequests(store, digest("owner-one"), digest),
    two = new PendingRequests(store, digest("owner-two"), digest);
  const initial = one.prepare("conversation-one", { text: "Original input" });
  assert.notEqual(
    one.prepare("conversation-one", { text: "Changed input" }).requestId,
    initial.requestId,
  );
  assert.notEqual(
    two.prepare("conversation-one", { text: "Original input" }).requestId,
    initial.requestId,
  );
  assert.equal(
    one.prepare("conversation-one", { text: "Original input" }).requestId,
    initial.requestId,
  );
});
test("request identity generation works with only getRandomValues on direct HTTP LAN origins", () => {
  const value = secureRequestId({
    getRandomValues: (array) => webcrypto.getRandomValues(array),
  });
  assert.match(
    value,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});
