const OUTPUT_TYPE = "conversation-output";
export const CONVERSATION_PROJECTION_TYPE = "conversation-projection-v1";
const OUTPUT_KINDS = new Set(["answer", "progress", "question", "system-notice"]);
const TERMINAL_STOP_REASONS = new Set(["error", "aborted", "length", "toolUse"]);

function requireNonEmptyText(value) {
  if (typeof value !== "string" || !value.trim())
    throw new TypeError("conversation output requires non-empty text");
  return value.trim();
}

/** Build the only record shape accepted by the user-facing projector. */
export function conversationOutput(kind, content, details = undefined) {
  if (!OUTPUT_KINDS.has(kind)) throw new TypeError(`unsupported conversation output kind: ${kind}`);
  const record = { role: "assistant", kind, content: requireNonEmptyText(content) };
  if(details?.outputKey) record.outputKey=requireNonEmptyText(details.outputKey);
  if (details?.verifierIssue !== undefined) {
    const issue = requireNonEmptyText(details.verifierIssue);
    record.details = { verifierIssue: issue.slice(0, 300) };
  }
  return record;
}

/**
 * Trusted backend write seam. Do not expose this as a model tool: model-created
 * custom messages are not accepted by the visibility projector.
 */
export function appendConversationOutput(manager, kind, content, details = undefined) {
  const record = conversationOutput(kind, content, details);
  return manager.appendCustomEntry(OUTPUT_TYPE, record);
}

export const publishConversationOutput = appendConversationOutput;
export const CONVERSATION_OUTPUT_TYPE = OUTPUT_TYPE;

/** Install an explicit boundary before any runtime-generated native output. */
export function ensureConversationProjection(manager) {
  if (!manager?.getBranch || !manager?.appendCustomMessageEntry) return false;
  if (manager.getBranch().some((entry) => entry?.type === "custom_message" && entry.customType === CONVERSATION_PROJECTION_TYPE)) return false;
  manager.appendCustomMessageEntry(CONVERSATION_PROJECTION_TYPE, JSON.stringify({ version: 1, historicalFinalBoundary: "safe" }), false);
  return true;
}

function textFromContent(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text).join("\n").trim();
}

function hasToolCall(message) {
  return Array.isArray(message?.content) && message.content.some((part) => part?.type === "toolCall");
}

function completedAssistant(message) {
  return message?.role === "assistant" && !hasToolCall(message) && Boolean(textFromContent(message.content)) &&
    !TERMINAL_STOP_REASONS.has(message.stopReason);
}

function publicMessage(message) {
  const text = textFromContent(message.content);
  const content = typeof message.content === "string"
    ? text
    : (Array.isArray(message.content) ? message.content.filter((part) => part?.type === "text" || part?.type === "image") : []);
  return { role: message.role, timestamp: message.timestamp, content };
}

function explicitPublicRecord(entry) {
  if (entry?.type !== "custom" || entry.customType !== OUTPUT_TYPE) return null;
  const data = entry.data;
  if (!data || data.role !== "assistant" || !OUTPUT_KINDS.has(data.kind)) return null;
  if (typeof data.content !== "string" || !data.content.trim()) return null;
  const record = { role: "assistant", kind: data.kind, content: data.content.trim() };
  if (typeof data.details?.verifierIssue === "string" && data.details.verifierIssue.trim())
    record.details = { verifierIssue: data.details.verifierIssue.trim().slice(0, 300) };
  return record;
}

/**
 * Project normal user-visible conversation history. Assistant messages are
 * emitted only at a completed turn boundary; executor messages are omitted.
 */
export function conversationVisibility(sessionOrEntries, { redact = (x) => x } = {}) {
  const entries = Array.isArray(sessionOrEntries) ? sessionOrEntries : sessionOrEntries?.sessionManager?.getBranch?.() ?? [];
  const visible = [];
  let candidate = null;
  let blocked = false;
  let explicitOnly = false;
  const flush = () => { if (candidate && !blocked) visible.push(candidate); candidate = null; blocked = false; };
  for (const entry of entries) {
    if (entry?.type === "custom_message" && entry.customType === CONVERSATION_PROJECTION_TYPE) {
      // Flush only the safe pre-boundary candidate. Tool churn is never a
      // historical final answer, and all later native assistant text is held.
      flush();
      explicitOnly = true;
      continue;
    }
    const explicit = explicitPublicRecord(entry);
    if (explicit) { flush(); visible.push(explicit); continue; }
    if (entry?.type !== "message") continue;
    const message = entry.message;
    if (message?.role === "user") { flush(); visible.push(publicMessage(message)); continue; }
    if (explicitOnly) continue;
    if (message?.role === "toolResult") { blocked = true; continue; }
    if (message?.role === "assistant") {
      if (completedAssistant(message)) { candidate = publicMessage(message); blocked = false; }
      else if (hasToolCall(message)) { blocked = true; candidate = null; }
    }
  }
  flush();
  return visible.filter((item) => item.content !== "" && (!Array.isArray(item.content) || item.content.length > 0));
}

/** Internal-only audit view; unlike normal visibility, it retains executor records. */
export function conversationAudit(sessionOrEntries) {
  const entries = Array.isArray(sessionOrEntries) ? sessionOrEntries : sessionOrEntries?.sessionManager?.getBranch?.() ?? [];
  return entries.filter((entry) => entry?.type === "message" &&
    (entry.message?.role === "toolResult" || hasToolCall(entry.message)));
}
