import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** Privileged AMP calls require TLS, except local development loopback. */
export function secureAmpTransport(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(u.hostname);
}

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export const effectHash = (name, args) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical([name, args])))
    .digest("hex");

/** Owner-only local filesystem authority. Never accepts the ordinary chat token. */
export class OwnerAuthority {
  constructor(root) {
    this.root = root;
    this.file = root + "/config/secrets/owner-approval-key";
  }
  initialize() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const base = fs.realpathSync(this.root);
    if (!fs.realpathSync(path.dirname(this.file)).startsWith(base + path.sep))
      throw Error("Owner key must remain inside the application private root");
    const descriptor = fs.openSync(this.file, "wx", 0o600);
    try {
      fs.writeFileSync(
        descriptor,
        crypto.randomBytes(32).toString("hex") + "\n",
      );
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    return { initialized: true, path: this.file };
  }
  key() {
    const stat = fs.lstatSync(this.file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077)
      throw Error(
        "Owner authority requires an independent private mode-600 regular key file",
      );
    const text = fs.readFileSync(this.file, "utf8").trim();
    if (!/^[a-f0-9]{64}$/.test(text))
      throw Error("Invalid owner authority key");
    return Buffer.from(text, "hex");
  }
  available() {
    try {
      this.key();
      return true;
    } catch {
      return false;
    }
  }
  sign(payload) {
    if (!payload || !["exact", "scope"].includes(payload.kind))
      throw Error("Known owner grant kind required");
    if (payload.risk === "sensitive" && payload.acknowledgedSensitive !== true)
      throw Error(
        "Sensitive effect requires explicit stronger acknowledgement",
      );
    const body = { ...payload, version: 1, issuer: "local-owner-cli" };
    delete body.signature;
    return {
      ...body,
      signature: crypto
        .createHmac("sha256", this.key())
        .update(JSON.stringify(canonical(body)))
        .digest("hex"),
    };
  }
  verify(grant, now = Date.now()) {
    try {
      if (
        !grant ||
        grant.version !== 1 ||
        grant.issuer !== "local-owner-cli" ||
        !["exact", "scope"].includes(grant.kind) ||
        !/^[a-f0-9]{64}$/.test(grant.signature) ||
        !Number.isFinite(grant.expiresAt) ||
        grant.expiresAt <= now ||
        (grant.risk === "sensitive" && grant.acknowledgedSensitive !== true)
      )
        return false;
      const body = { ...grant };
      delete body.signature;
      const expected = crypto
        .createHmac("sha256", this.key())
        .update(JSON.stringify(canonical(body)))
        .digest();
      return crypto.timingSafeEqual(
        expected,
        Buffer.from(grant.signature, "hex"),
      );
    } catch {
      return false;
    }
  }
}
