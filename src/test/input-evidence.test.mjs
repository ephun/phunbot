import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  goalImages,
  planReviewData,
  requirePlanEvidenceReview,
} from "../input-evidence.mjs";
import { validateAttachments } from "../input-evidence.mjs";
test("a supplied new goal ID with no canonical marker cannot inherit another request image", () => {
  const m = SessionManager.inMemory();
  m.appendMessage({
    role: "user",
    timestamp: 3000,
    content: [{ type: "image", data: "UNSCOPED", mimeType: "image/png" }],
  });
  assert.deepEqual(goalImages(m, new Date(2000).toISOString(), "new-goal"), []);
});
test("caller-controlled legacy request prefixes cannot bypass image isolation in plan metadata", () => {
  const m = SessionManager.inMemory();
  m.appendMessage({
    role: "user",
    timestamp: 3000,
    content: [{ type: "image", data: "OTHER", mimeType: "image/png" }],
  });
  assert.equal(
    planReviewData(
      m,
      {
        id: "new-goal",
        requestId: "legacy-caller-controlled",
        created: new Date(2000).toISOString(),
      },
      [],
    ).attachmentCount,
    0,
  );
});
test("queued image requests never inherit an earlier goal image delivered after their acceptance", () => {
  const m = SessionManager.inMemory();
  m.appendCustomMessageEntry(
    "goal-context",
    "Active goal first. Continue.",
    false,
  );
  m.appendMessage({
    role: "user",
    timestamp: 3000,
    content: [{ type: "image", data: "OTHER", mimeType: "image/png" }],
  });
  m.appendCustomMessageEntry(
    "goal-context",
    "Active goal second. Continue.",
    false,
  );
  m.appendMessage({
    role: "user",
    timestamp: 4000,
    content: [{ type: "image", data: "OWN", mimeType: "image/png" }],
  });
  assert.deepEqual(
    goalImages(m, new Date(2000).toISOString(), "second").map((x) => x.data),
    ["OWN"],
  );
});
test("attachments have a strict aggregate byte budget and valid base64 before admission", () => {
  const one = {
    mimeType: "image/png",
    data: Buffer.alloc(3 * 1024 * 1024).toString("base64"),
  };
  assert.throws(() => validateAttachments([one, one]), /aggregate|budget/i);
  assert.throws(
    () => validateAttachments([{ mimeType: "image/png", data: "invalid!" }]),
    /base64/i,
  );
  assert.equal(
    validateAttachments([{ mimeType: "image/png", data: "aGVsbG8=" }]).length,
    1,
  );
});
test("missing reviewer models fail before image decoration", async () => {
  const m = await import("../input-evidence.mjs");
  assert.equal(typeof m.reviewModel, "function");
  assert.throws(() => m.reviewModel(undefined, true), /reviewer unavailable/);
  assert.deepEqual(m.reviewModel({ id: "fixture" }, true).input, [
    "text",
    "image",
  ]);
});
test("image admission follows the configured role rather than an alias literal", async () => {
  const m = await import("../input-evidence.mjs");
  assert.equal(typeof m.imageRoleAllowed, "function");
  assert.equal(
    m.imageRoleAllowed("fixture-vision", { vision: "fixture-vision" }),
    true,
  );
  assert.equal(
    m.imageRoleAllowed("fleet-vision", { vision: "fixture-vision" }),
    false,
  );
  assert.equal(m.imageRoleAllowed(undefined, {}), false);
});
test("image recovery aliases retain attachment delivery rather than silently becoming text-only", async () => {
  const m = await import("../input-evidence.mjs");
  assert.equal(
    m.imageRoleAllowed(
      "alternate",
      { vision: "primary" },
      { visionEscalationModel: "alternate" },
    ),
    true,
  );
  assert.equal(
    m
      .selectableModelIds(
        { vision: "primary" },
        { visionEscalationModel: "alternate" },
      )
      .has("alternate"),
    true,
  );
});
test("configured interactive roles remain selectable while embedding-only roles do not", async () => {
  const m = await import("../input-evidence.mjs");
  assert.equal(typeof m.selectableModelIds, "function");
  const ids = m.selectableModelIds({
    vision: "fixture-vision",
    executor: "fixture-executor",
    embedding: "fixture-embedding",
  });
  assert.equal(ids.has("fixture-vision"), true);
  assert.equal(ids.has("fixture-executor"), true);
  assert.equal(ids.has("fixture-embedding"), false);
});
test("plan reviewers receive explicit actual attachment metadata", () => {
  const m = SessionManager.inMemory();
  m.appendMessage({
    role: "user",
    content: [{ type: "image", mimeType: "image/png", data: "fixture" }],
    timestamp: 3000,
  });
  const p = planReviewData(m, { created: new Date(2000).toISOString() }, [], {
    vision: false,
    text: true,
  });
  assert.equal(p.attachmentCount, 1);
  assert.equal(p.reviewPhase, "proposed_plan_coverage");
  assert.deepEqual(p.registeredReviewers, { vision: false, text: true });
  assert.equal(p.declaredVerifierCapabilities.attachedImageReview, true);
  assert.equal(p.verifierCapabilities, undefined);
  assert.equal(p.goal.created, new Date(2000).toISOString());
});
test("image evidence comes from current-goal native user messages, not prior conversations or generated claims", () => {
  const m = SessionManager.inMemory();
  m.appendMessage({
    role: "user",
    timestamp: 1000,
    content: [{ type: "image", data: "OLD", mimeType: "image/png" }],
  });
  m.appendMessage({
    role: "user",
    timestamp: 3000,
    content: [{ type: "image", data: "CURRENT", mimeType: "image/png" }],
  });
  assert.deepEqual(
    goalImages(m, new Date(2000).toISOString()).map((x) => x.data),
    ["CURRENT"],
  );
});
test("attached-image proxy-only plan is rejected before admission", () => {
  const review = planReviewData(
    SessionManager.inMemory(),
    { created: new Date(2000).toISOString() },
    [],
    {},
  );
  review.attachmentCount = 1;
  assert.throws(
    () =>
      requirePlanEvidenceReview(review, [
        {
          verifier: {
            kind: "file_contains",
            path: "answer.txt",
            text: "red background",
          },
        },
        {
          verifier: {
            kind: "file_contains",
            path: "answer.txt",
            text: "blue square",
          },
        },
      ]),
    /evidence_review/,
  );
});
test("image plan with a real evidence_review criterion is admitted", () => {
  const review = { attachmentCount: 1 };
  assert.equal(
    requirePlanEvidenceReview(review, [
      {
        verifier: { kind: "file_contains", path: "answer.txt", text: "answer" },
      },
      { verifier: { kind: "evidence_review" } },
    ]),
    true,
  );
});
test("text-only file plan remains unchanged", () => {
  assert.equal(
    requirePlanEvidenceReview({ attachmentCount: 0 }, [
      {
        verifier: { kind: "file_contains", path: "answer.txt", text: "answer" },
      },
    ]),
    true,
  );
});
test("plan metadata attachment count comes from actual native attachment", () => {
  const m = SessionManager.inMemory();
  m.appendMessage({
    role: "user",
    timestamp: 3000,
    content: [{ type: "image", mimeType: "image/png", data: "ACTUAL" }],
  });
  m.appendMessage({
    role: "assistant",
    timestamp: 4000,
    content: [{ type: "text", text: "generated image claim" }],
  });
  const review = planReviewData(
    m,
    { created: new Date(2000).toISOString() },
    [],
    {},
  );
  assert.equal(review.attachmentCount, 1);
});
