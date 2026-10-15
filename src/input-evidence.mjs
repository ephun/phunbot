export function validateAttachments(images = []) {
  if (!Array.isArray(images) || images.length > 8)
    throw Error("Unsupported image count");
  let bytes = 0;
  for (const image of images) {
    if (
      !image ||
      !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
        image.mimeType,
      ) ||
      typeof image.data !== "string" ||
      image.data.length > 7000000
    )
      throw Error("Unsupported image format or size");
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        image.data,
      ) ||
      !image.data.length
    )
      throw Error("Valid base64 image data required");
    bytes += Buffer.byteLength(image.data, "base64");
    if (bytes > 5 * 1024 * 1024)
      throw Error("Aggregate attachment byte budget exceeded");
  }
  return images;
}
export function reviewModel(model, images = false) {
  if (!model) throw Error("Independent reviewer unavailable");
  return images ? { ...model, input: ["text", "image"] } : model;
}
export function imageRoleAllowed(selected, roles, routing = {}) {
  return [roles?.vision, routing.visionEscalationModel].some(
    (id) => typeof id === "string" && id.length > 0 && selected === id,
  );
}
export function selectableModelIds(roles = {}, routing = {}) {
  return new Set([
    "fleet-fast",
    "fleet-fast-spark",
    "fleet-deep",
    "fleet-vision",
    "fleet-code",
    ...[routing.escalationModel, routing.visionEscalationModel].filter(
      (id) => typeof id === "string" && id.length,
    ),
    ...["executor", "reviewer", "vision", "code"]
      .map((r) => roles[r])
      .filter((x) => typeof x === "string" && x.length),
  ]);
}
export function planReviewData(
  manager,
  goal,
  criteria,
  registeredReviewers = { vision: false, text: false },
) {
  return {
    reviewPhase: "proposed_plan_coverage",
    goal,
    criteria,
    registeredReviewers,
    declaredVerifierCapabilities: {
      attachedImageReview: true,
      candidateAnswerReview: true,
    },
    attachmentCount: goalImages(manager, goal.created, goal.id).length,
  };
}
export function requirePlanEvidenceReview(reviewData, criteria) {
  if (
    reviewData?.attachmentCount > 0 &&
    !criteria?.some((c) => c?.verifier?.kind === "evidence_review")
  )
    throw Error("Image goals require an evidence_review criterion");
  return true;
}
export function goalImages(manager, created, goalId) {
  const entries = manager.getBranch();
  const scoped =
    goalId &&
    entries.some(
      (e) =>
        e.type === "custom_message" &&
        e.customType === "goal-context" &&
        typeof e.content === "string" &&
        e.content.startsWith("Active goal " + goalId + "."),
    );
  if (goalId && !scoped) return [];
  let active = !scoped;
  const images = [];
  for (const entry of entries) {
    if (
      scoped &&
      entry.type === "custom_message" &&
      entry.customType === "goal-context"
    )
      active =
        typeof entry.content === "string" &&
        entry.content.startsWith("Active goal " + goalId + ".");
    if (
      active &&
      entry.type === "message" &&
      entry.message.role === "user" &&
      entry.message.timestamp >= Date.parse(created) &&
      Array.isArray(entry.message.content)
    )
      images.push(...entry.message.content.filter((c) => c.type === "image"));
  }
  return images;
}
