import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { containsCredential } from "./privacy.mjs";
import {
  privateDirectory,
  readPrivateText,
  createPrivateText,
} from "./private-files.mjs";

import { MemoryTelemetry, contentVersion } from "./memory-telemetry.mjs";

function requireAppendBoundary(text) {
  let fence = null;
  for (const line of text.split("\n")) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!match) continue;
    if (!fence) fence = { char: match[1][0], length: match[1].length };
    else if (
      match[1][0] === fence.char &&
      match[1].length >= fence.length &&
      !match[2].trim()
    )
      fence = null;
  }
  if (fence)
    throw Error(
      "Unclosed manual Markdown fence requires owner reconciliation before machine append",
    );
}
export class Memory {
  constructor(root, context = {}) {
    this.root = fs.realpathSync(root);
    this.telemetry = new MemoryTelemetry(this.root, context);
    for (const name of [
      "memory",
      "state/memory-locks",
      "state/memory-revisions",
    ]) {
      const directory = privateDirectory(this.root, name, { create: true });
      directory.close();
    }
  }
  file(id) {
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(id)) throw Error("Invalid note id");
    const dir = this.root + "/memory";
    if (fs.lstatSync(dir).isSymbolicLink())
      throw Error("Memory root symlink is not authorized");
    const file = dir + "/" + id + ".md";
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
      throw Error("Memory symlink is not authorized");
    return file;
  }
  locked(ids, operation) {
    const directory = privateDirectory(this.root, "state/memory-locks"),
      acquired = [];
    try {
      for (const id of [...new Set(ids)].sort()) {
        this.file(id);
        const name = id + ".lock",
          lock = directory.path + "/" + name;
        let done = false;
        for (let attempt = 0; attempt < 40; attempt++) {
          try {
            fs.mkdirSync(lock, { mode: 0o700 });
            acquired.push(lock);
            const owner = privateDirectory(
              this.root,
              "state/memory-locks/" + name,
            );
            try {
              createPrivateText(
                owner,
                "owner.json",
                JSON.stringify({ pid: process.pid, at: Date.now() }),
              );
            } finally {
              owner.close();
            }
            done = true;
            break;
          } catch (error) {
            if (error.code !== "EEXIST") throw error;
            const owner = privateDirectory(
              this.root,
              "state/memory-locks/" + name,
            );
            try {
              let data;
              try {
                data = JSON.parse(readPrivateText(owner, "owner.json"));
              } catch (error) {
                if (error.code !== "ENOENT") throw error;
              }
              if (data) {
                try {
                  process.kill(data.pid, 0);
                } catch (error) {
                  if (error.code === "ESRCH") {
                    fs.rmSync(lock, { recursive: true });
                    continue;
                  }
                  throw error;
                }
              }
            } finally {
              owner.close();
            }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
          }
        }
        if (!done)
          throw Error("Memory note is busy; retry after current update");
      }
      return operation();
    } finally {
      for (const lock of acquired.reverse())
        fs.rmSync(lock, { recursive: true, force: true });
      directory.close();
    }
  }
  get(id, { internal = false } = {}) {
    this.file(id);
    const directory = privateDirectory(this.root, "memory");
    try {
      const text = readPrivateText(directory, id + ".md");
      this.telemetry.emit("read", {
        notes: [{ id, version: contentVersion(text) }],
      });
      return text;
    } finally {
      directory.close();
    }
  }
  writeLocked(id, text, metadata = {}) {
    if (containsCredential(text))
      throw Error("Potential secret or credential cannot be stored in memory");
    this.file(id);
    const directory = privateDirectory(this.root, "memory");
    let temp;
    try {
      let old;
      try {
        old = readPrivateText(directory, id + ".md");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (old === text) {
        this.telemetry.emit("write_unchanged", {
          notes: [{ id, version: contentVersion(text) }],
        });
        return { id, unchanged: true };
      }
      let preservedRevision;
      if (old !== undefined) {
        const revisions = privateDirectory(this.root, "state/memory-revisions");
        try {
          preservedRevision =
            id + "-" + Date.now() + "-" + crypto.randomUUID() + ".md";
          createPrivateText(revisions, preservedRevision, old);
          fs.fsyncSync(revisions.fd);
        } finally {
          revisions.close();
        }
      }
      temp = id + ".tmp-" + crypto.randomUUID();
      createPrivateText(directory, temp, text);
      fs.renameSync(
        directory.path + "/" + temp,
        directory.path + "/" + id + ".md",
      );
      temp = null;
      fs.fsyncSync(directory.fd);
      this.telemetry.emit(
        metadata.successorId
          ? "supersede"
          : old === undefined
            ? "create"
            : "revise",
        {
          notes: [{ id, version: contentVersion(text) }],
          previousVersion: old === undefined ? null : contentVersion(old),
          ...(preservedRevision ? { preservedRevision } : {}),
          ...metadata,
        },
      );
      this.relationshipChanges(id, old || "", text);
      return {
        id,
        sha256: crypto.createHash("sha256").update(text).digest("hex"),
      };
    } finally {
      if (temp) fs.rmSync(directory.path + "/" + temp, { force: true });
      directory.close();
    }
  }
  save(id, text) {
    return this.locked([id], () => this.writeLocked(id, text));
  }
  put(id, title, body, source) {
    if (
      !source ||
      !title ||
      !body ||
      [title, body, source].some((x) => typeof x !== "string")
    )
      throw Error("Provenance, title and body required");
    return this.locked([id], () => {
      const observationId = crypto
        .createHash("sha256")
        .update(JSON.stringify([title.trim(), body.trim(), source.trim()]))
        .digest("hex");
      const marker = "<!-- phunbot-observation:" + observationId + " -->";
      const recordedAt = new Date().toISOString();
      if (fs.existsSync(this.file(id))) {
        const prior = this.get(id);
        if (prior.includes(marker)) return { id, unchanged: true };
        requireAppendBoundary(prior);
        // Ordinary observation is append-only: the agent must not reconstruct
        // a human-edited note or silently replace unrelated sections/frontmatter.
        return this.writeLocked(
          id,
          prior +
            "\n\n## Additional observation (unreconciled)\n\n" +
            marker +
            "\n\n" +
            body.trim() +
            "\n\nSource: " +
            JSON.stringify(source) +
            "\nRecorded: " +
            recordedAt +
            "\n",
        );
      }
      return this.writeLocked(
        id,
        "---\nid: " +
          id +
          "\nsource: " +
          JSON.stringify(source) +
          "\nupdated: " +
          recordedAt +
          "\nstatus: observed\n---\n\n# " +
          title.replace(/\n/g, " ") +
          "\n\n" +
          marker +
          "\n\n" +
          body.trim() +
          "\n",
      );
    });
  }
  list({ observe = true } = {}) {
    const directory = privateDirectory(this.root, "memory");
    try {
      const result = fs
        .readdirSync(directory.path)
        .filter((name) => name.endsWith(".md"))
        .map((name) => ({
          id: name.slice(0, -3),
          text: readPrivateText(directory, name),
        }));
      if (observe)
        this.telemetry.batch(
          "enumerate",
          result.map((n) => ({ id: n.id, version: contentVersion(n.text) })),
        );
      return result;
    } finally {
      directory.close();
    }
  }
  search(query) {
    if (typeof query !== "string") throw Error("Search query required");
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results = this.list({ observe: false })
      .map((n) => ({
        ...n,
        score: words.reduce(
          (s, w) => s + (n.text.toLowerCase().includes(w) ? 1 : 0),
          0,
        ),
      }))
      .filter((n) => n.score)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    this.recordRetrieval("lexical", results);
    return results;
  }
  link(a, b, reason) {
    if (a === b || !reason || typeof reason !== "string")
      throw Error("Meaningful reason required");
    return this.locked([a, b], () => {
      requireAppendBoundary(this.get(a));
      requireAppendBoundary(this.get(b));
      for (const [from, to] of [
        [a, b],
        [b, a],
      ]) {
        let text = this.get(from);
        if (text.includes("[[" + to + "]]")) continue;
        if (!text.includes("\n## Inferred relationships\n"))
          text +=
            "\n## Inferred relationships\n\n<!-- phunbot-owned inferred links; manual sections above are unchanged -->\n";
        text +=
          "\n- [[" +
          to +
          "]] <!-- phunbot-inferred: " +
          reason.replace(/-->/g, "").replace(/\n/g, " ") +
          " -->\n";
        this.writeLocked(from, text);
      }
      return { linked: [a, b], reason };
    });
  }

  withContext(context, fn) {
    return this.telemetry.withContext(context, fn);
  }
  telemetryStatus() {
    return this.telemetry.status();
  }
  recordRetrieval(mode, notes) {
    return this.telemetry.batch(
      "search",
      notes.map((n, i) => ({
        id: n.id,
        version: contentVersion(n.text),
        rank: i + 1,
        ...(Number.isFinite(n.score) ? { score: n.score } : {}),
      })),
      { mode },
    );
  }
  recordContextSupply(
    notes,
    suppliedText,
    { perNoteLimit = Infinity, redacted = false } = {},
  ) {
    let offset = 0;
    const included = [];
    for (const [index, n] of notes.entries()) {
      if (index) offset += 2;
      if (offset >= suppliedText.length) break;
      const available = Math.min(n.text.length, perNoteLimit);
      const length = Math.min(
        available,
        Math.max(0, suppliedText.length - offset),
      );
      if (length <= 0) continue;
      included.push({
        id: n.id,
        version: contentVersion(n.text),
        rank: included.length + 1,
        includedChars: length,
        truncated: length < n.text.length,
      });
      offset += available;
    }
    return this.telemetry.batch("context", included, {
      suppliedChars: suppliedText.length,
      redacted,
    });
  }
  relationshipChanges(id, old, current) {
    const links = (text) => {
      const out = new Map();
      for (const line of text.split("\n"))
        for (const match of line.matchAll(
          /\[\[([a-z0-9][a-z0-9-]{0,99})(?:\|[^\]]+)?\]\]/g,
        )) {
          const marker = line
            .slice(match.index + match[0].length)
            .match(/^\s*<!-- phunbot-inferred:.*?-->/);
          const value = {
            kind: marker ? "inferred" : "explicit",
            assertion: match[0] + (marker?.[0] || ""),
          };
          const group = out.get(match[1]) || [];
          group.push(value);
          out.set(match[1], group);
        }
      return new Map(
        [...out].map(([target, claims]) => [
          target,
          {
            kind: claims.every((c) => c.kind === "inferred")
              ? "inferred"
              : "explicit",
            hash: contentVersion(
              JSON.stringify(
                claims.sort((a, b) => a.assertion.localeCompare(b.assertion)),
              ),
            ),
          },
        ]),
      );
    };
    const before = links(old),
      after = links(current);
    for (const targetId of new Set([...before.keys(), ...after.keys()])) {
      const a = before.get(targetId),
        b = after.get(targetId);
      if (a?.hash === b?.hash) continue;
      this.telemetry.emit("relationship", {
        source: { id, version: current ? contentVersion(current) : null },
        targetId,
        kind: (b || a).kind,
        action: !a ? "created" : !b ? "removed" : "modified",
        assertionHash: (b || a).hash,
        ...(a && b
          ? { previousKind: a.kind, previousAssertionHash: a.hash }
          : {}),
      });
    }
  }
  supersede(id, successorId) {
    if (id === successorId) throw Error("Supersession requires distinct notes");
    return this.locked([id, successorId], () => {
      const old = this.get(id);
      this.get(successorId);
      const front = old.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      let text;
      if (front) {
        let metadata = front[1];
        metadata = /^status:.*$/m.test(metadata)
          ? metadata.replace(/^status:.*$/m, "status: superseded")
          : metadata + "\nstatus: superseded";
        metadata = /^superseded_by:.*$/m.test(metadata)
          ? metadata.replace(
              /^superseded_by:.*$/m,
              "superseded_by: " + successorId,
            )
          : metadata + "\nsuperseded_by: " + successorId;
        text = "---\n" + metadata + "\n---\n" + old.slice(front[0].length);
      } else
        text =
          "---\nstatus: superseded\nsuperseded_by: " +
          successorId +
          "\n---\n\n" +
          old;
      return this.writeLocked(id, text, { successorId });
    });
  }
  delete(id) {
    return this.locked([id], () => {
      let old;
      try {
        old = this.get(id);
      } catch (error) {
        if (error.code === "ENOENT") return { id, unchanged: true };
        throw error;
      }
      const revisions = privateDirectory(this.root, "state/memory-revisions");
      const preservedRevision =
        id + "-deleted-" + Date.now() + "-" + crypto.randomUUID() + ".md";
      try {
        createPrivateText(revisions, preservedRevision, old);
        fs.fsyncSync(revisions.fd);
      } finally {
        revisions.close();
      }
      const d = privateDirectory(this.root, "memory");
      try {
        fs.unlinkSync(d.path + "/" + id + ".md");
        fs.fsyncSync(d.fd);
      } finally {
        d.close();
      }
      this.telemetry.emit("delete", {
        notes: [{ id, version: null }],
        previousVersion: contentVersion(old),
        preservedRevision,
      });
      this.relationshipChanges(id, old, "");
      return { id, deleted: true };
    });
  }
  reconcileTelemetry({ acknowledgeGap = false } = {}) {
    return this.withContext({ phase: "reconciliation" }, () => {
      const events = this.telemetry.audit(),
        known = new Map();
      for (const e of events) {
        if (
          ["create", "revise", "supersede", "delete", "reconcile"].includes(
            e.operation,
          )
        )
          for (const n of e.notes) known.set(n.id, n.version);
      }
      const live = new Map(
        this.list({ observe: false }).map((n) => [
          n.id,
          contentVersion(n.text),
        ]),
      );
      const notes = [...new Set([...known.keys(), ...live.keys()])]
        .sort()
        .map((id) => {
          const expectedVersion = known.get(id) ?? null,
            version = live.get(id) ?? null;
          return {
            id,
            version,
            expectedVersion,
            state:
              version === expectedVersion
                ? "unchanged"
                : version === null
                  ? "missing"
                  : expectedVersion === null
                    ? "untracked"
                    : "changed",
          };
        });
      const differences = notes.filter((n) => n.state !== "unchanged");
      if (!this.telemetryStatus().ok && !acknowledgeGap)
        return { ok: false, needsReconciliation: true, differences };
      // Explicit acknowledgement retains all old records. The new snapshot records
      // uncertainty, not invented mutation timestamps or content.
      const status = this.telemetry.batch(
        "reconcile",
        notes,
        {},
        { recovering: acknowledgeGap },
      );
      if (status.ok && acknowledgeGap) this.telemetry.acknowledge();
      return { ...status, differences };
    });
  }
}

for (const name of [
  "get",
  "save",
  "put",
  "link",
  "delete",
  "supersede",
  "search",
  "list",
]) {
  const original = Memory.prototype[name];
  Memory.prototype[name] = function (...args) {
    try {
      return original.apply(this, args);
    } catch (error) {
      this.telemetry.emit("operation_failed", {
        failedOperation: { get: "read", list: "enumerate" }[name] || name,
        errorClass:
          error.code === "ENOENT"
            ? "not_found"
            : error.code
              ? "io"
              : "rejected",
      });
      throw error;
    }
  };
}
