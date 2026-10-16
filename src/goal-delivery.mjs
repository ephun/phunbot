// Delivery is deduplicated by the durable request ID on the actual Pi message.
// Append before invoking a turn, so aborted execution does not lose user input.
export function deliverGoalRequests(session, goal) {
  const manager = session.sessionManager;
  if (!manager) return false; // Controlled sessions may provide prompt-only APIs.
  const delivered = new Set(manager.getBranch().filter(e=>e.type==='message').map(e=>e.message.phunbotRequestId).filter(Boolean));
  let changed=false;
  const appended=[];
  for (const request of goal.requestHistory || []) {
    if (!request.requestId || delivered.has(request.requestId)) continue;
    manager.appendCustomMessageEntry("goal-context", "Active goal " + goal.id + ". Request " + request.requestId, false);
    manager.appendMessage({role:'user',timestamp:Date.parse(request.receivedAt)||Date.now(),
      phunbotRequestId:request.requestId,phunbotGoalId:goal.id,
      content:[{type:'text',text:request.text},...(request.images || []).map(i=>({type:'image',...i}))]});
    appended.push(request);
    delivered.add(request.requestId); changed=true;
  }
  if (changed && session.agent) session.agent.replaceMessages(manager.buildSessionContext().messages);
  return appended;
}
