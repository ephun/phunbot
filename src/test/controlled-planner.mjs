// Controlled planning seam for HTTP/UI tests. This is not provider acceptance.
export async function controlledPlanner(_runtime, _policy, goal, _history, criteria) {
  const current = criteria.map(t=>({title:t.title,verifier:t.verifier}));
  return {
    title:goal.title, description:goal.request,
    criteria:current.length ? current : [{title:'Provide a substantive answer to the request',verifier:{kind:goal.requestHistory?.some(r=>r.images?.length) ? 'evidence_review' : 'answer_quality'}}],
    subgoals:[],changes:['Controlled test planner incorporated current request revision'],
    execution:goal.paused ? 'pause' : 'continue'
  };
}
