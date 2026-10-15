// Unacknowledged admission metadata only: never a second conversation store.
export function secureRequestId(provider = globalThis.crypto) {
  const bytes = provider.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
export class PendingRequests {
  constructor(storage, namespace, digest) {
    if (!/^[a-f0-9]{64}$/.test(namespace) || typeof digest !== "function")
      throw Error("A private owner namespace and SHA256 digest are required");
    this.storage = storage;
    this.namespace = namespace;
    this.digest = digest;
  }
  prepare(conversationId, payload) {
    const fingerprint = this.digest(JSON.stringify(payload));
    const key =
      "phunbot-pending:" +
      this.namespace +
      ":" +
      conversationId +
      ":" +
      fingerprint;
    const stored = this.storage.getItem(key);
    let request;
    if (stored !== null) {
      try {
        request = JSON.parse(stored);
      } catch {
        throw Error(
          "Pending submission metadata is corrupt; reconcile the existing request before retrying",
        );
      }
      if (
        request.conversationId !== conversationId ||
        request.fingerprint !== fingerprint ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          request.requestId || "",
        )
      )
        throw Error(
          "Pending submission identity is invalid; reconcile before retrying",
        );
    } else {
      request = { conversationId, fingerprint, requestId: secureRequestId() };
      this.storage.setItem(key, JSON.stringify(request));
    }
    return { ...request, key };
  }
  acknowledge(request) {
    const stored = this.storage.getItem(request.key);
    if (stored && JSON.parse(stored).requestId === request.requestId)
      this.storage.removeItem(request.key);
  }
}
