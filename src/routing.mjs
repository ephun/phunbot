// Harness routing only; neither goal authority nor a second reasoning loop.
export function recordReviewFailure(
  checkpoint,
  tool,
  isError,
  selected,
  policy,
  hasImages = false,
) {
  if (
    !policy.routing?.enabled ||
    !["goal_plan", "goal_verify", "goal_blocker"].includes(tool)
  )
    return null;
  const counts = (checkpoint.reviewFailures ??= {});
  counts[tool] = isError ? (counts[tool] || 0) + 1 : 0;
  const reviewer = hasImages
    ? policy.routing.visionEscalationModel
    : policy.routing.escalationModel || policy.roles?.reviewer;
  if (
    !isError ||
    selected === reviewer ||
    !reviewer ||
    counts[tool] < (policy.routing.reviewFailuresBeforeEscalation ?? 3)
  )
    return null;
  return {
    model: reviewer,
    reason: `${tool} failed independent review ${counts[tool]} consecutive times; configured alternative strategy/model takes over the same Pi session and Nextcloud goal.`,
  };
}
