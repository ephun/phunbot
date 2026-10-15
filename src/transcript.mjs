import { redact } from "./controller.mjs";

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
    if (part.type === "toolCall")
      return [
        {
          type: "toolCall",
          id: part.id,
          name: part.name,
          arguments: redact(part.arguments),
        },
      ];
    return [];
  });
}
export function conversationMessages(session) {
  return session.sessionManager
    .getBranch()
    .flatMap((entry) =>
      entry.type === "message"
        ? ["user", "assistant", "toolResult"].includes(entry.message.role)
          ? [
              {
                role: entry.message.role,
                timestamp: entry.message.timestamp,
                content: publicContent(entry.message.content),
                ...(entry.message.toolName
                  ? {
                      toolName: entry.message.toolName,
                      toolCallId: entry.message.toolCallId,
                      isError: entry.message.isError,
                    }
                  : {}),
              },
            ]
          : []
        : entry.type === "custom_message" && entry.display
          ? [
              {
                role: "custom",
                customType: entry.customType,
                content: publicContent(entry.content),
                display: true,
              },
            ]
          : [],
    )
    .filter((m) => m.role !== "custom" || m.display !== false);
}
