# Conversation goals and lifecycle

## Authority and admission

Pi retains the canonical conversation. Nextcloud's dedicated PhunBot calendar retains parent goals, acceptance criteria, message admission receipts, revisions and execution leases. Markdown remains semantic memory, n8n awakens eligible work, and MCP/Pi-native tools supply capabilities. The browser is a presentation layer.

A conversation has at most one open parent goal. Paused, blocked and waiting parents still occupy that slot. Every subsequent message joins that parent regardless of subject. A terminal parent's next new request creates an independent parent; no successor/dependency graph is added.

Each message carries a separate stable `requestId` and content hash. A per-conversation CAS lease serializes admission across processes. A durable creation reservation permits recovery if a parent write or its HTTP response is lost. Receipts remain attached to their original parent, including after it closes. Retrying an old request does not create a new parent. Local serialization avoids unnecessary conflicts within one application process; an overlapping independent writer may receive a retryable admission conflict.

## Planning and execution

`policy.roles.planner`, when supplied, selects the deep planner; otherwise the configured `roles.reviewer` is used. `roles.executor` supplies the normal executor. No model names are embedded in planning logic. Planning is one bounded structured Pi runtime operation, separate from execution and verification.

The planner receives current authoritative goal state, contributing requests, conversation history, current criteria and real execution evidence. It proposes the current description, criteria, local subgoals, revision explanations and execution disposition. The controller validates criteria and persists the accepted plan. Subgoals organize work; they do not stand in for criteria or create another conversation parent.

A new message invalidates the old lease and increments the authoritative revision before another execution can publish acceptance. The current Pi turn is interrupted; planning incorporates the latest revision before the fast executor continues. Repeated ineffective execution yields to deep replanning rather than silently changing the executor into the planner. ETags, lease tokens and plan revisions fence stale publication. Real observations from an interrupted tool call remain inspectable, but a stale attempt cannot accept the revised goal.

Unchanged current criteria can retain their useful accepted evidence. Removed criteria remain stored and are identified as superseded in plan history. Reintroducing a superseded criterion creates a fresh criterion instance instead of reviving its old acceptance receipt. The UI exposes the current description/criteria, revision explanations and expandable previous plans.

## User actions

- **Pause** revokes execution authority, interrupts active work and durably suspends the open goal. Scheduled recovery does not resume it.
- **Resume** retains the goal identity and sends it through current-plan interpretation before execution.
- **Cancel** permanently abandons the parent and preserves its history/evidence.
- **Complete** permanently closes the parent at user direction without altering unfinished criteria or manufacturing verification.

There is no additional user-facing Stop action. A new message to a paused goal is interpreted by the planner but does not itself authorize resuming consequential work. Only an explicit resume disposition lifts that pause.

Successful verification closes a parent with `completionKind: verified`. An explicit action or planner-recognized user instruction records `completionKind: user-directed`. Terminal parents cannot resume, replan or accept further verification. Native informational answers receive a separate deep review in the running application; external effects still require actual tool evidence and accepted parent verification receipts.

## Compatibility and recovery

`GET /api/goal-migration` is an authenticated, read-only reconciliation report. Existing catalog goal pointers and exact checkpoint/session-file associations can establish legacy membership. Recovery/admission fail closed if open parents cannot be unambiguously associated or if a conversation has multiple open parents. No automatic merge, cancellation or deletion resolves ambiguity. Safe additive membership updates preserve IDs, criteria, evidence, terminal states and session references.

Run only one application writer against a local runtime directory. Nextcloud admission/verification CAS does not turn local checkpoint files into a cross-process database. Existing n8n `/api/resume` awakenings use the same pause, terminal, ambiguity, backoff and lease gates; they do not own another execution loop.

## Evidence boundaries

Controlled HTTP/Pi/native/browser fixtures demonstrate application behavior, not production deployment or real AMP effects. Before deployment, validate the actual Nextcloud TLS identity/CA/pin, production model roles, exact source/build identity, targeted backup and rollback, and the existing recovery workflow. Never weaken TLS or owner authorization to make an acceptance check pass.

A live consequential AMP mutation is optional for deployment when no explicitly authorized disposable target exists and consequential operations remain gated. Record that operational test as outstanding; do not mutate an arbitrary production instance.
