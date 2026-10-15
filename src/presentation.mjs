// A projection only. Canonical messages remain in Pi, never local browser storage.
export function projectConversation(entries) {
  const messages = [],
    traces = [];
  for (const [index, entry] of entries.entries()) {
    const role = entry.role;
    const content =
      typeof entry.content === "string"
        ? [{ type: "text", text: entry.content }]
        : entry.content || [];
    const text = content
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
    const key =
      entry.entryId || role + ":" + (entry.timestamp ?? "") + ":" + index;
    if (role === "user" || role === "assistant") {
      const images =
        role === "user" ? content.filter((part) => part.type === "image") : [];
      if (text || images.length) messages.push({ key, role, text, images });
      for (const part of content.filter((part) => part.type === "toolCall"))
        traces.push({
          key: key + ":" + part.id,
          label: part.name || "Tool call",
          text: JSON.stringify(part.arguments || {}, null, 2),
        });
    } else if (role === "toolResult" || role === "custom") {
      traces.push({
        key,
        label: entry.toolName || entry.customType || "Execution",
        text,
      });
    }
  }
  return { messages, traces };
}
export function executionLabel(state) {
  return (
    {
      idle: "Ready",
      queued: "Queued",
      starting: "Starting",
      running: "Working",
      yielded: "Checkpoint saved",
      waiting_capacity: "Waiting for capacity",
      transient_failure: "Retry scheduled",
      ineffective_strategy: "Reconsidering approach",
      blocked: "Blocked",
      verified_complete: "Verified complete",
      cancelled: "Cancelled",
      cancelling: "Stopping",
      recovered: "Recovered",
    }[state] ||
    state ||
    "Ready"
  );
}
