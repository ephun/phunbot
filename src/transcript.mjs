import { redact } from "./controller.mjs";
import { conversationVisibility, ensureConversationProjection } from "./conversation-output.mjs";

export function appendCanonicalUserTurn(manager, text, { requestId, goalId, timestamp = Date.now(), images = [] } = {}) {
  if (!manager?.appendMessage || typeof text !== "string" || !text.trim()) throw new TypeError("canonical user turn requires text");
  const existing = manager.getBranch?.().some((entry) => entry?.type === "message" && entry.message?.phunbotRequestId === requestId);
  if (requestId && existing) return false;
  manager.appendMessage({ role: "user", timestamp, ...(requestId ? { phunbotRequestId: requestId } : {}), ...(goalId ? { phunbotGoalId: goalId } : {}), content: [{ type: "text", text }, ...images.map((image) => ({ type: "image", ...image }))] });
  return true;
}

export { ensureConversationProjection };

export function requestDelivered(manager, goalId, request) {
  let active = false;
  for (const entry of manager.getBranch()) {
    if (entry.type === "custom_message" && entry.customType === "goal-context")
      active =
        typeof entry.content === "string" &&
        entry.content.startsWith("Active goal " + goalId + ".");
    if (active && entry.type === "message" && entry.message.role === "user") {
      const content = entry.message.content;
      const text =
        typeof content === "string"
          ? content
          : content
              .filter((c) => c.type === "text")
              .map((c) => c.text)
              .join("\n");
      if (text === request) return true;
    }
  }
  return false;
}
export function responseEvidence(message, notBefore = 0) {
  if (
    message?.role !== "assistant" ||
    typeof message.timestamp !== "number" ||
    message.timestamp < notBefore ||
    !Array.isArray(message.content)
  )
    return null;
  const text = message.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n")
    .trim();
  return text
    ? {
        source:
          "Actual Pi assistant output; not independent proof of external state",
        text,
      }
    : null;
}
function publicContent(content) {
  if (typeof content === "string") return redact(content);
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    if (part.type === "text" && typeof part.text === "string")
      return [{ type: "text", text: redact(part.text) }];
    if (part.type === "image")
      return [{ type: "image", mimeType: part.mimeType, data: part.data }];
    return [];
  });
}
export function conversationMessages(session) {
  return conversationVisibility(session, { redact }).map((message) => ({
    ...message,
    content: publicContent(message.content),
  }));
}
