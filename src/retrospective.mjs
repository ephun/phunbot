import fs from "node:fs";
import { containsCredential } from "./privacy.mjs";
import { redact } from "./controller.mjs";
import {
  acquirePrivateLock,
  readPrivateText,
  replacePrivateText,
} from "./private-files.mjs";

function visibleRecord(entry) {
  if (
    entry.type !== "message" ||
    !["user", "assistant", "toolResult"].includes(entry.message?.role)
  )
    return null;
  const message = entry.message;
  const text =
    typeof message.content === "string"
      ? message.content
      : (message.content || [])
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
  if (!text.trim() || containsCredential(text)) return null;
  return {
    id: entry.id,
    role: message.role,
    ...(message.role === "toolResult" ? { toolName: message.toolName } : {}),
    isError: message.isError === true,
    text: redact(text).slice(0, 3000),
  };
}

function acceptable(proposal, records) {
  if (
    !proposal ||
    proposal.durable !== true ||
    !/^[a-z0-9][a-z0-9-]{0,99}$/.test(proposal.id || "")
  )
    return false;
  if (
    typeof proposal.title !== "string" ||
    !proposal.title.trim() ||
    proposal.title.length > 160 ||
    typeof proposal.body !== "string" ||
    proposal.body.trim().length < 20 ||
    proposal.body.length > 1200 ||
    typeof proposal.reason !== "string" ||
    !proposal.reason.trim()
  )
    return false;
  if (
    !Array.isArray(proposal.sourceIds) ||
    !proposal.sourceIds.length ||
    proposal.sourceIds.length > 5
  )
    return false;
  const sources = proposal.sourceIds.map((id) =>
    records.find((record) => record.id === id),
  );
  if (
    sources.some(
      (source) =>
        !source ||
        source.isError ||
        !["user", "toolResult"].includes(source.role),
    )
  )
    return false;
  // Owner statements can be first-party evidence. Otherwise require at least
  // two distinct successful, named diagnostic observations, never a self-written
  // artifact or an arbitrary tool-shaped string presented as readback.
  const diagnosticSources = sources.filter(
    (source) => source.role === "toolResult",
  );
  if (
    diagnosticSources.some(
      (source) =>
        !/^mcp__amp__amp_(?:get_|read_|list_)|^mcp__phunbot__(?:service_probe|web_fetch)$/.test(
          source.toolName || "",
        ),
    )
  )
    return false;
  if (!sources.some((source) => source.role === "user")) {
    if (
      diagnosticSources.length < 2 ||
      new Set(diagnosticSources.map((source) => source.text)).size < 2
    )
      return false;
  }
  // These are concise authored observations, never a pasted transcript or a plan to act.
  if (
    sources.some((source) => source.text.trim() === proposal.body.trim()) ||
    /^(?:thanks?\b|hello\b|hi\b|I will\b|working on\b|TODO\b)/i.test(
      proposal.body.trim(),
    )
  )
    return false;
  return true;
}

/** Incremental learning checkpoints are processing pointers, not another knowledge store. */
export async function consolidateSessions(
  root,
  memory,
  sessions,
  review,
  options,
) {
  const lock = acquirePrivateLock(root, "session-learning");
  if (!lock)
    return {
      busy: true,
      reviewedSessions: 0,
      reviewedEntries: 0,
      written: 0,
      rejected: 0,
      noteIds: [],
    };
  try {
    return await consolidateLocked(
      root,
      memory,
      sessions,
      review,
      options,
      lock.directory,
    );
  } finally {
    lock.release();
  }
}
async function consolidateLocked(
  root,
  memory,
  sessions,
  review,
  { maxSessions = 1, maxEntries = 80, maxChars = 12000 } = {},
  directory,
) {
  const file = "session-learning.json";
  let state = { version: 1, sessions: {} };
  try {
    state = JSON.parse(readPrivateText(directory, file));
  } catch (error) {
    if (error.code !== "ENOENT")
      throw Error(
        "Session learning checkpoint is unreadable; preserve it for recovery",
      );
  }
  if (
    state.version !== 1 ||
    !state.sessions ||
    typeof state.sessions !== "object" ||
    Array.isArray(state.sessions)
  )
    throw Error("Invalid session learning checkpoint");
  if (
    ![maxSessions, maxEntries, maxChars].every(
      (n) => Number.isInteger(n) && n > 0,
    )
  )
    throw Error("Positive bounded learning limits required");
  const report = {
    reviewedSessions: 0,
    reviewedEntries: 0,
    written: 0,
    rejected: 0,
    noteIds: [],
  };
  const pivot =
    sessions.findIndex((session) => session.id === state.lastSessionId) + 1;
  const ordered = [...sessions.slice(pivot), ...sessions.slice(0, pivot)];
  for (const session of ordered) {
    if (report.reviewedSessions >= Math.min(maxSessions, 5)) break;
    const entries = session.entries || session.loadEntries?.();
    if (
      typeof session.id !== "string" ||
      !/^[a-zA-Z0-9-]+$/.test(session.id) ||
      !Array.isArray(entries)
    )
      throw Error("Canonical session identity and entries required");
    const cursor = Object.hasOwn(state.sessions, session.id)
      ? state.sessions[session.id]
      : undefined;
    const previousIndex = cursor
      ? entries.findIndex((entry) => entry.id === cursor)
      : -1;
    if (cursor && previousIndex < 0)
      throw Error(
        "Learning cursor missing from canonical history; explicit reconciliation required",
      );
    const pending = entries.slice(
      previousIndex + 1,
      previousIndex + 1 + Math.min(maxEntries, 200),
    );
    if (!pending.length) continue;
    const records = [];
    let chars = 0;
    let last;
    for (const entry of pending) {
      const record = visibleRecord(entry);
      if (record && records.length && chars + record.text.length > maxChars)
        break;
      last = entry;
      if (record) {
        record.text = record.text.slice(0, maxChars - chars);
        records.push(record);
        chars += record.text.length;
      }
    }
    if (!last?.id)
      throw Error("Canonical entry identity required for learning checkpoint");
    if (
      records.some(
        (record) =>
          ["user", "toolResult"].includes(record.role) && !record.isError,
      )
    ) {
      const verdict = await review({ sessionId: session.id, records });
      if (
        !Array.isArray(verdict?.observations) ||
        verdict.observations.length > 5
      )
        throw Error("Invalid bounded session learning review");
      for (const proposal of verdict.observations) {
        if (!acceptable(proposal, records)) {
          report.rejected++;
          continue;
        }
        const source =
          "Pi session " +
          session.id +
          ", entries " +
          proposal.sourceIds.join(", ");
        const result = memory.withContext({sessionId:session.id,phase:"retrospective"}, () => memory.put(
          proposal.id,
          proposal.title,
          proposal.body,
          source,
        ));
        if (!result.unchanged) {
          report.written++;
          report.noteIds.push(proposal.id);
        }
      }
    }
    state.sessions[session.id] = last.id;
    state.lastSessionId = session.id;
    replacePrivateText(directory, file, JSON.stringify(state, null, 2));
    report.reviewedSessions++;
    report.reviewedEntries += pending.indexOf(last) + 1;
  }
  return report;
}
