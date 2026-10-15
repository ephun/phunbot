import { test } from "node:test";
import assert from "node:assert/strict";
import { recordReviewFailure } from "../routing.mjs";
test("routing honors an explicitly configured escalation executor separate from the verdict reviewer", () => {
  const cp = { reviewFailures: { goal_plan: 2 } };
  const configured = {
    routing: { enabled: true, escalationModel: "strong-chat" },
    roles: { reviewer: "verdict-only" },
  };
  assert.equal(
    recordReviewFailure(cp, "goal_plan", true, "fast", configured).model,
    "strong-chat",
  );
  assert.equal(
    recordReviewFailure(cp, "goal_plan", true, "strong-chat", configured),
    null,
  );
});
test("a separately configured image-capable recovery target can replace a failing image executor", () => {
  const configured = {
    roles: { reviewer: "text-only" },
    routing: {
      enabled: true,
      reviewFailuresBeforeEscalation: 2,
      escalationModel: "text-only",
      visionEscalationModel: "validated-image-alternative",
    },
  };
  const cp = {};
  assert.equal(
    recordReviewFailure(
      cp,
      "goal_verify",
      true,
      "image-primary",
      configured,
      true,
    ),
    null,
  );
  assert.equal(
    recordReviewFailure(
      cp,
      "goal_verify",
      true,
      "image-primary",
      configured,
      true,
    )?.model,
    "validated-image-alternative",
  );
  assert.equal(
    recordReviewFailure(
      cp,
      "goal_verify",
      true,
      "validated-image-alternative",
      configured,
      true,
    ),
    null,
  );
});
const policy = {
  routing: { enabled: true, reviewFailuresBeforeEscalation: 3 },
  roles: { reviewer: "reviewer" },
};
test("repeated malformed blocker proposals escalate instead of allowing an unproductive denial loop", () => {
  const cp = { reviewFailures: { goal_blocker: 2 } };
  assert.equal(
    recordReviewFailure(cp, "goal_blocker", true, "weak", policy).model,
    "reviewer",
  );
});
test("repeated rejected plans route the same Pi goal to its configured stronger reviewer", () => {
  const cp = {};
  assert.equal(
    recordReviewFailure(cp, "goal_plan", true, "fast", policy),
    null,
  );
  assert.equal(
    recordReviewFailure(cp, "goal_plan", true, "fast", policy),
    null,
  );
  assert.equal(
    recordReviewFailure(cp, "goal_plan", true, "fast", policy).model,
    "reviewer",
  );
  assert.equal(
    recordReviewFailure(cp, "goal_plan", true, "reviewer", policy),
    null,
  );
});
test("routing preserves image-capable selection, respects disabled policy and resets after success", () => {
  const cp = { reviewFailures: { goal_verify: 2 } };
  assert.equal(
    recordReviewFailure(cp, "goal_verify", true, "vision", policy, true),
    null,
  );
  assert.equal(
    recordReviewFailure(cp, "goal_verify", true, "fast", {
      ...policy,
      routing: { enabled: false },
    }),
    null,
  );
  assert.equal(
    recordReviewFailure(cp, "goal_verify", false, "fast", policy),
    null,
  );
  assert.equal(cp.reviewFailures.goal_verify, 0);
  assert.equal(recordReviewFailure(cp, "write", true, "fast", policy), null);
});
