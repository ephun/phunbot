import {
  privateDirectory,
  readPrivateText
} from "./private-files.mjs";
import {
  redact
} from "./controller.mjs";

const parseResult = value => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

function checkpoint(root, id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9-]{1,200}$/.test(id)) throw Error("Invalid goal identity");
  const directory = privateDirectory(root, "state/executions", {
    create: true
  });
  try {
    let value;
    try {
      value = JSON.parse(readPrivateText(directory, id + ".json"));
    } catch (error) {
      if (error.code === "ENOENT") return {
        evidence: []
      };
      throw error;
    }
    if (!value || !Array.isArray(value.evidence)) throw Error("Invalid execution history");
    return value;
  } finally {
    directory.close();
  }
}

function summary(event) {
  const result = parseResult(event.result);
  if (typeof result === "string") return result.slice(0, 240);
  if (result && typeof result === "object") {
    if (typeof result.text === "string") return result.text.slice(0, 240);
    if (typeof result.reason === "string") return result.reason.slice(0, 240);
  }
  return event.error ? "Activity failed" : "Activity recorded";
}
export function compactHistory(root, id, {
  limit = 20,
  offset = 0,
  expand = false
} = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) throw Error("Invalid history pagination");
  const events = checkpoint(root, id).evidence;
  const items = events.slice(offset, offset + limit).map(event => redact({
    id: event.id,
    at: event.at,
    tool: event.tool,
    error: Boolean(event.error),
    summary: summary(event),
    ...(expand ? {
      args: parseResult(event.args),
      result: parseResult(event.result)
    } : {}),
  }));
  const hasMore = offset + items.length < events.length;
  return {
    count: events.length,
    items,
    hasMore,
    nextOffset: hasMore ? offset + items.length : null
  };
}
export function goalReadModels({
  goals,
  catalog,
  root,
  live = new Map(),
  folders = [],
  criterionAccepted
}) {
  const byParent = new Map();
  for (const item of goals)
    if (item.kind === "criterion") {
      const list = byParent.get(item.parent) || [];
      list.push(item);
      byParent.set(item.parent, list);
    }
  const sessions = new Map(catalog.map(row => [row.id, row]));
  return goals.filter(goal => goal.kind === "goal").map(goal => {
    const row = sessions.get(goal.conversationId),
      runtime = live.get(goal.id) || {};
    const observations = checkpoint(root, goal.id).evidence;
    const criteria = (byParent.get(goal.id) || []).filter(t=>!goal.expectedChildIds || goal.expectedChildIds.includes(t.id)).map(criterion => ({
      id: criterion.id,
      title: criterion.title,
      status: criterion.status,
      verifier: criterion.verifier,
      evidence: redact(criterion.evidence || null),
      activity: (() => {
        const ids = new Set(criterion.evidence?.evidenceIds || []);
        const related = observations.filter(event => {
          const args = parseResult(event.args);
          return ids.has(event.id) || args?.taskId === criterion.id || args?.criterionId === criterion.id;
        });
        return {
          count: related.length,
          items: related.slice(0, 20).map(event => redact({
            id: event.id,
            at: event.at,
            tool: event.tool,
            error: Boolean(event.error),
            summary: summary(event)
          }))
        };
      })(),
      accepted: Boolean(criterionAccepted ? criterionAccepted(goal, criterion) :
        criterion.status === "COMPLETED" && criterion.evidence?.verifiedAt &&
        (!criterion.evidence.verificationId || goal.verificationReceipts?.[criterion.id] === criterion.evidence.verificationId)),
    }));
    return {
      id: goal.id,
      title: goal.title,
      request: goal.request,
      description: goal.description,
      subgoals: goal.subgoals || [],
      planChanges: goal.planChanges || [],
      planRevisions: redact(goal.planRevisions || []),
      revision: goal.revision || 1,
      requestReceipts: (goal.requestReceipts || []).map(({ requestId, requestHash, goalId, receivedAt, revision }) => ({ requestId, requestHash, goalId, receivedAt, revision })),
      created: goal.created,
      parentId: goal.parent || null,
      childGoals: goals.filter(item => item.kind === "goal" && item.parent === goal.id).map(item => ({
        id: item.id,
        title: item.title,
        status: item.status
      })),
      persistentStatus: goal.status,
      completionKind: goal.completionKind || null,
      paused: Boolean(goal.paused || goal.execution?.state === "paused"),
      status: goal.status,
      liveExecution: {
        state: runtime.busy || runtime.inFlight ? "running" : "idle",
        persistedState: goal.execution?.state || "idle",
        error: runtime.error || null
      },
      execution: goal.execution || null,
      session: row ? {
        id: row.id,
        title: row.title,
        folder: row.folderId ? folders.find(f => f.id === row.folderId)?.name || null : row.folder || null,
        folderId: row.folderId || null
      } : goal.conversationId ? {
        id: goal.conversationId
      } : null,
      folder: folders.find(folder => folder.id === row?.folderId) || null,
      acceptanceCriteria: criteria,
      activity: compactHistory(root, goal.id),
      blocker: redact(goal.blocker || null),
      authorizations: (goal.authorizations || []).map(item => redact(item)),
    };
  });
}
