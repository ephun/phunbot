import fs from "node:fs";
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { containsCredential } from "./privacy.mjs";
import {
  privateDirectory,
  privateFile,
  readPrivateText,
  replacePrivateText,
  acquirePrivateLock,
} from "./private-files.mjs";

export const contentVersion = (text) =>
  crypto.createHash("sha256").update(text).digest("hex");
const ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const HASH = /^[a-f0-9]{64}$/;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const PHASES = new Set([
  "agent",
  "immediate",
  "retrospective",
  "maintenance",
  "mcp",
  "reconciliation",
]);
const OPS = new Set([
  "create",
  "revise",
  "supersede",
  "delete",
  "write_unchanged",
  "read",
  "enumerate",
  "search",
  "context",
  "relationship",
  "operation_failed",
  "reconcile",
]);
const ACTIONS = new Set([
  "read",
  "save",
  "put",
  "link",
  "delete",
  "supersede",
  "search",
  "enumerate",
]);
const COMMON = [
  "schemaVersion",
  "eventId",
  "observedAt",
  "operation",
  "outcome",
  "context",
];
const FIELDS = [
  "notes",
  "previousVersion",
  "preservedRevision",
  "successorId",
  "mode",
  "source",
  "targetId",
  "kind",
  "action",
  "previousKind",
  "assertionHash",
  "previousAssertionHash",
  "batchId",
  "batchIndex",
  "finalBatch",
  "suppliedChars",
  "redacted",
  "failedOperation",
  "errorClass",
];
const NOTE_FIELDS = [
  "id",
  "version",
  "rank",
  "score",
  "includedChars",
  "truncated",
  "expectedVersion",
  "state",
];
const failureCode = (error) =>
  ["ENOSPC", "EACCES", "EPERM", "EIO", "EROFS"].includes(error?.code)
    ? error.code
    : "JOURNAL_UNAVAILABLE";
function requireValue(condition) {
  if (!condition) throw Error("Invalid memory telemetry record");
}
function keys(value, allowed) {
  requireValue(value && typeof value === "object" && !Array.isArray(value));
  requireValue(Object.keys(value).every((key) => allowed.includes(key)));
}
function contextFields(value = {}) {
  keys(value, ["sessionId", "goalId", "phase"]);
  const out = {};
  for (const name of ["sessionId", "goalId"])
    if (value[name] !== undefined) {
      requireValue(
        typeof value[name] === "string" &&
          /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(value[name]) &&
          !containsCredential(value[name]),
      );
      out[name] = value[name];
    }
  if (value.phase !== undefined) {
    requireValue(PHASES.has(value.phase));
    out.phase = value.phase;
  }
  return out;
}
function note(value) {
  keys(value, NOTE_FIELDS);
  requireValue(ID.test(value.id) && typeof value.id === "string");
  requireValue(
    value.version === null ||
      (typeof value.version === "string" && HASH.test(value.version)),
  );
  if (value.rank !== undefined)
    requireValue(Number.isSafeInteger(value.rank) && value.rank > 0);
  if (value.score !== undefined) requireValue(Number.isFinite(value.score));
  if (value.includedChars !== undefined)
    requireValue(
      Number.isSafeInteger(value.includedChars) && value.includedChars >= 0,
    );
  if (value.truncated !== undefined)
    requireValue(typeof value.truncated === "boolean");
  if (value.expectedVersion !== undefined)
    requireValue(
      value.expectedVersion === null || HASH.test(value.expectedVersion),
    );
  if (value.state !== undefined)
    requireValue(
      ["unchanged", "untracked", "changed", "missing"].includes(value.state),
    );
}
const BATCH = ["batchId", "batchIndex", "finalBatch"];
const OP_FIELDS = {
  create: ["notes", "previousVersion"],
  revise: ["notes", "previousVersion", "preservedRevision"],
  supersede: ["notes", "previousVersion", "preservedRevision", "successorId"],
  delete: ["notes", "previousVersion", "preservedRevision"],
  write_unchanged: ["notes"],
  read: ["notes"],
  enumerate: ["notes", ...BATCH],
  search: ["notes", "mode", ...BATCH],
  context: ["notes", "suppliedChars", "redacted", ...BATCH],
  relationship: [
    "source",
    "targetId",
    "kind",
    "action",
    "previousKind",
    "assertionHash",
    "previousAssertionHash",
  ],
  operation_failed: ["failedOperation", "errorClass"],
  reconcile: ["notes", ...BATCH],
};
function validate(row) {
  keys(row, [...COMMON, ...(OP_FIELDS[row?.operation] || [])]);
  requireValue(
    row.schemaVersion === 1 &&
      UUID.test(row.eventId) &&
      typeof row.observedAt === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.observedAt) &&
      Number.isFinite(Date.parse(row.observedAt)) &&
      new Date(row.observedAt).toISOString() === row.observedAt &&
      OPS.has(row.operation),
  );
  requireValue(
    row.outcome ===
      (row.operation === "operation_failed" ? "failed" : "observed"),
  );
  contextFields(row.context);
  if (row.notes !== undefined) {
    requireValue(Array.isArray(row.notes) && row.notes.length <= 100);
    row.notes.forEach(note);
  }
  if (
    [
      "create",
      "revise",
      "supersede",
      "delete",
      "write_unchanged",
      "read",
    ].includes(row.operation)
  )
    requireValue(row.notes?.length === 1);
  if (["enumerate", "search", "context", "reconcile"].includes(row.operation))
    requireValue(Array.isArray(row.notes));
  if (["revise", "supersede", "delete"].includes(row.operation))
    requireValue(
      HASH.test(row.previousVersion) &&
        typeof row.preservedRevision === "string",
    );
  if (
    [
      "create",
      "revise",
      "supersede",
      "read",
      "write_unchanged",
      "enumerate",
    ].includes(row.operation)
  )
    requireValue(row.notes.every((n) => n.version !== null));
  if (row.operation === "create") requireValue(row.previousVersion === null);
  if (row.operation === "delete") requireValue(row.notes[0].version === null);
  if (row.notes)
    for (const n of row.notes) {
      const allowed = [
        "id",
        "version",
        ...(row.operation === "search"
          ? ["rank", "score"]
          : row.operation === "context"
            ? ["rank", "includedChars", "truncated"]
            : row.operation === "reconcile"
              ? ["expectedVersion", "state"]
              : []),
      ];
      keys(n, allowed);
    }
  if (row.previousVersion !== undefined)
    requireValue(
      row.previousVersion === null || HASH.test(row.previousVersion),
    );
  if (row.preservedRevision !== undefined)
    requireValue(
      /^[a-z0-9][a-z0-9-]*\.md$/.test(row.preservedRevision) &&
        row.preservedRevision.length <= 255,
    );
  if (row.successorId !== undefined)
    requireValue(
      typeof row.successorId === "string" && ID.test(row.successorId),
    );
  if (row.operation === "supersede")
    requireValue(row.successorId && row.successorId !== row.notes[0].id);
  if (row.mode !== undefined)
    requireValue(["lexical", "semantic"].includes(row.mode));
  if (row.operation === "search")
    requireValue(
      row.mode &&
        row.notes.every(
          (n) => n.version !== null && Number.isSafeInteger(n.rank),
        ),
    );
  if (row.operation === "context")
    requireValue(
      row.notes.every(
        (n) =>
          n.version !== null &&
          Number.isSafeInteger(n.includedChars) &&
          typeof n.truncated === "boolean",
      ),
    );
  if (row.operation === "relationship") {
    note(row.source);
    requireValue(
      ID.test(row.targetId) &&
        ["inferred", "explicit"].includes(row.kind) &&
        ["created", "removed", "modified"].includes(row.action),
    );
    requireValue(HASH.test(row.assertionHash));
  }
  if (row.previousKind !== undefined)
    requireValue(["inferred", "explicit"].includes(row.previousKind));
  for (const field of ["assertionHash", "previousAssertionHash"])
    if (row[field] !== undefined) requireValue(HASH.test(row[field]));
  if (row.batchId !== undefined)
    requireValue(
      UUID.test(row.batchId) &&
        Number.isSafeInteger(row.batchIndex) &&
        row.batchIndex >= 0 &&
        typeof row.finalBatch === "boolean",
    );
  if (row.redacted !== undefined)
    requireValue(typeof row.redacted === "boolean");
  if (row.suppliedChars !== undefined)
    requireValue(
      Number.isSafeInteger(row.suppliedChars) && row.suppliedChars >= 0,
    );
  if (row.operation === "operation_failed")
    requireValue(
      ACTIONS.has(row.failedOperation) &&
        ["not_found", "rejected", "io"].includes(row.errorClass),
    );
  if (row.operation === "reconcile")
    requireValue(row.notes.every((n) => n.state));
  return row;
}

/** Private observational journal. Failures never change note contents or model decisions. */
export class MemoryTelemetry {
  constructor(root, context = {}) {
    this.root = fs.realpathSync(root);
    this.baseContext = contextFields(context);
    this.scopes = new AsyncLocalStorage();
    this.failure = null;
    this.validated = null;
    try {
      const directory = privateDirectory(this.root, "state/memory-telemetry", {
        create: true,
      });
      directory.close();
      this._locked(() => {
        const d = privateDirectory(this.root, "state/memory-telemetry");
        try {
          const fd = privateFile(
            d,
            "observations.jsonl",
            fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_APPEND,
          );
          try {
            fs.fchmodSync(fd, 0o600);
            fs.fsyncSync(fd);
            this._validateSince(fd, true);
          } finally {
            fs.closeSync(fd);
          }
          fs.fsyncSync(d.fd);
          const parent = privateDirectory(this.root, "state");
          try {
            fs.fsyncSync(parent.fd);
          } finally {
            parent.close();
          }
          const rootFd = fs.openSync(
            this.root,
            fs.constants.O_RDONLY |
              fs.constants.O_DIRECTORY |
              fs.constants.O_NOFOLLOW,
          );
          try {
            fs.fsyncSync(rootFd);
          } finally {
            fs.closeSync(rootFd);
          }
          this._readFailure(d);
        } finally {
          d.close();
        }
      });
    } catch (error) {
      this._fail(error);
    }
  }
  _locked(fn) {
    // Never race to reap a stale pathname. A crash-held lock is an explicit
    // operator recovery boundary, not permission to remove a concurrent lock.
    for (let attempt = 0; attempt < 1000; attempt++) {
      let lock;
      try {
        lock = acquirePrivateLock(this.root, "memory-telemetry", {
          reclaim: false,
        });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      // A releasing owner may remove its directory between EEXIST and open.
      if (lock) {
        try {
          return fn();
        } finally {
          lock.release();
        }
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
    throw Error("Memory telemetry lock unavailable");
  }
  _readFailure(directory) {
    try {
      const marker = JSON.parse(readPrivateText(directory, "failure.json"));
      requireValue(
        marker.schemaVersion === 1 && typeof marker.failedAt === "string",
      );
      this.failure = {
        code: "RECONCILIATION_REQUIRED",
        failedAt: marker.failedAt,
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  _fail(error) {
    if (!this.failure) {
      this.failure = {
        code: failureCode(error),
        failedAt: new Date().toISOString(),
      };
      // Fixed text only: never disclose exception messages, paths or user input.
      console.error(
        "Memory telemetry unavailable; operator reconciliation required.",
      );
    }
    try {
      const d = privateDirectory(this.root, "state/memory-telemetry", {
        create: true,
      });
      try {
        replacePrivateText(
          d,
          "failure.json",
          JSON.stringify({ schemaVersion: 1, ...this.failure }) + "\n",
        );
      } finally {
        d.close();
      }
    } catch {
      /* stderr plus in-process health remain visible even on a full disk. */
    }
  }
  _validateSince(fd, full = false) {
    const stat = fs.fstatSync(fd);
    requireValue(stat.isFile());
    let offset = full || !this.validated ? 0 : this.validated.offset;
    if (this.validated && !full)
      requireValue(
        stat.dev === this.validated.dev &&
          stat.ino === this.validated.ino &&
          stat.size >= offset,
      );
    if (stat.size > offset) {
      const bytes = Buffer.alloc(stat.size - offset);
      let read = 0;
      while (read < bytes.length) {
        const n = fs.readSync(
          fd,
          bytes,
          read,
          bytes.length - read,
          offset + read,
        );
        requireValue(n > 0);
        read += n;
      }
      requireValue(bytes.at(-1) === 10);
      for (const line of bytes.toString("utf8").slice(0, -1).split("\n"))
        validate(JSON.parse(line));
    }
    this.validated = { dev: stat.dev, ino: stat.ino, offset: stat.size };
  }
  withContext(context, fn) {
    return this.scopes.run(
      {
        ...this.baseContext,
        ...this.scopes.getStore(),
        ...contextFields(context),
      },
      fn,
    );
  }
  emit(operation, fields = {}, { recovering = false } = {}) {
    if (this.failure && !recovering) return this.status();
    try {
      keys(fields, FIELDS);
      const row = validate({
        schemaVersion: 1,
        eventId: crypto.randomUUID(),
        observedAt: new Date().toISOString(),
        operation,
        outcome: operation === "operation_failed" ? "failed" : "observed",
        context: { ...this.baseContext, ...this.scopes.getStore() },
        ...fields,
      });
      return this._locked(() => {
        const d = privateDirectory(this.root, "state/memory-telemetry");
        try {
          if (!recovering) {
            this._readFailure(d);
            if (this.failure) return this.status();
          }
          const fd = privateFile(
            d,
            "observations.jsonl",
            fs.constants.O_RDWR | fs.constants.O_APPEND,
          );
          try {
            this._validateSince(fd);
            const bytes = Buffer.from(JSON.stringify(row) + "\n");
            let offset = 0;
            while (offset < bytes.length) {
              const n = fs.writeSync(fd, bytes, offset, bytes.length - offset);
              requireValue(n > 0);
              offset += n;
            }
            fs.fsyncSync(fd);
            this.validated.offset += bytes.length;
          } finally {
            fs.closeSync(fd);
          }
          return { ok: true, eventId: row.eventId };
        } finally {
          d.close();
        }
      });
    } catch (error) {
      this._fail(error);
      return this.status();
    }
  }
  batch(operation, notes, fields = {}, options = {}) {
    const batchId = crypto.randomUUID();
    let status = { ok: true };
    for (let i = 0; i < Math.max(1, notes.length); i += 100) {
      status = this.emit(
        operation,
        {
          ...fields,
          notes: notes.slice(i, i + 100),
          batchId,
          batchIndex: i / 100,
          finalBatch: i + 100 >= notes.length,
        },
        options,
      );
      if (!status.ok) break;
    }
    return status;
  }
  status() {
    try {
      const d = privateDirectory(this.root, "state/memory-telemetry");
      try {
        this._readFailure(d);
      } finally {
        d.close();
      }
    } catch (error) {
      if (!this.failure) this._fail(error);
    }
    return this.failure
      ? { ok: false, needsReconciliation: true, ...this.failure }
      : { ok: true, needsReconciliation: false };
  }
  audit() {
    return this._locked(() => {
      const d = privateDirectory(this.root, "state/memory-telemetry");
      try {
        const fd = privateFile(d, "observations.jsonl");
        try {
          this._validateSince(fd, true);
        } finally {
          fs.closeSync(fd);
        }
        return readPrivateText(d, "observations.jsonl")
          .split("\n")
          .filter(Boolean)
          .map(JSON.parse);
      } finally {
        d.close();
      }
    });
  }
  acknowledge() {
    this._locked(() => {
      const d = privateDirectory(this.root, "state/memory-telemetry");
      try {
        const fd = privateFile(d, "observations.jsonl");
        try {
          this._validateSince(fd, true);
        } finally {
          fs.closeSync(fd);
        }
        fs.rmSync(d.path + "/failure.json", { force: true });
        fs.fsyncSync(d.fd);
        this.failure = null;
      } finally {
        d.close();
      }
    });
  }
}
