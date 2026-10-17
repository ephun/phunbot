# Conversational correction: API diagnosis and candidate validation

This is an isolated application correction, not a production deployment. Production configuration, credentials, canonical histories and existing goal records remain untouched. Local provider/Tasks fixtures are explicitly controlled fixtures, not evidence of a real AMP operation.

## API acceptance investigation

The exact deployed hotfix and the candidate have **no `POST /api/goal` route**. An authenticated probe of the running hotfix returned `404 {"error":"Not found"}`. `/health` returned 200 with no source drift; `GET /api/goals` returned 200 and both existing goal parents already had `planReady: true`. A missing credential path or state mount is therefore not established as the cause of the reported singular-route failure. Dependencies absent from an exported source directory are not proof of missing runtime dependencies.

Use the existing conversation admission API, not a guessed singular endpoint:

1. `POST /api/sessions` to create a conversation.
2. `POST /api/sessions/{conversationId}/send` with `{ "requestId": "a-stable-unique-id", "text": "the user's goal" }`.
3. Poll `GET /api/goals`; use the returned `goalId`. Accepted plan materialization requires `planReady: true`, nonempty `expectedChildIds`, and every matching child under that parent.

The actual native Pi integration runs these HTTP requests against the application with a controlled streaming provider and durable Tasks fixture. It asserts materialization within 60 seconds **without changing planner timeouts or weakening acceptance**. It separately checks verified answer delivery after completion. The 60-second assertion is a fixture result, not a production latency SLA: upstream model/network latency and existing occupied execution slots still matter. No test goal was created in production.

## Demonstrated defects corrected

- Expired slow control reservations could dispatch twice. The regression first observed two callbacks instead of one. An irreversible authoritative pre-dispatch CAS now prevents reclamation after dispatch begins; uncertain crash results remain fail-closed.
- Control IDs could be reused across goal rollover, and ordinary admission could reuse a control ID. Conversation-wide checks under the shared admission lock now reject both directions. Goal identity is part of the receipt key.
- Direct lifecycle HTTP routes bypassed the shared admission lock. A real HTTP concurrency regression demonstrated the bypass, then passed after integration.
- A typed malformed/truncated reviewer result was retried by failure reconciliation and subsequent wakeups. It now suspends unchanged verification, preserves unaccepted criteria, and publishes one concise `system-notice`. A new substantive user request can initiate controlled recovery at a new revision; generic `/api/resume` cannot erase the suspension.
- Successful native settlement was not publishing its verified final because the terminal goal no longer passed an open-goal lease check, and the continuation return value was discarded. Publication now reconciles the settled decision with the same goal/revision/lease identity and excludes cancelled or user-completed/stale work.
- Proposal presentation incorrectly treated Pi's returned message-ID string as an object, preventing durable disclosure binding. The native regression now verifies the actual displayed question identity in the consumed decision receipt.
- The explicit transcript boundary suppressed subsequent user messages as well as private assistant text. User turns now remain visible; historical controller records are audit-only. Canonical history is not edited.

## Validation commands

See the repository README for all checks. Use a real installed Chromium via `PHUNBOT_CHROMIUM` for browser acceptance, static smoke and sidebar checks, and `CHROMIUM_EXECUTABLE` for prototype integration. Output evidence should be outside the source tree:

- `npm test --prefix src` (includes memory and telemetry)
- `npm test --prefix src/vendor/amp`
- `npm run build --prefix src/vendor/amp`
- `node src/integration/native-faults.mjs`
- From `src`: `node browser/acceptance.mjs`, `node test_ui.mjs`, `node integration/ui-browser.mjs`, `node integration/sidebar-overflow.mjs`
- From `src`: `uv run --with pillow python integration/ui-compare.py /path/to/ui-evidence`
- `node src/source-verify.mjs --compact`

Native coverage includes provider outage recovery, delayed cancellation across process restart, denial before effect, malformed verifier notice/retry fencing, API plan acceptance within 60 seconds, actual proposal → authenticated yes → at-most-one fixture effect, and proposal → no → no effect.

Final isolated runs used both Node 22.19.0 and Node 26.5.1 with identical candidate source bytes: application 310/310; AMP 35/35 plus build; native nine checks; all browser/geometry/smoke/sidebar checks passed. A fresh independent review reported no security or logic defects and passed 38 targeted tests. Its additional bare `node --test` command discovered vendor TypeScript tests and failed seven module resolutions (312/319); those tests require their documented Vitest package runner, which passed 35/35. This is a runner-discovery limitation, not a claim that the bare command passed. No exclusions or timeouts were weakened.

## Initial informational deep-planning regression

The configured `litellm/fleet-deep` model (Pi `openai-responses`) reproduced the reported question using an isolated synthetic goal and empty personal context. The response ended normally after about 43 seconds. Its JSON had top-level `goal`, `subgoals`, `criteria`, and `action`; the application required top-level `title`, `description`, `criteria`, `subgoals`, `changes`, and `execution`. The Responses payload carried `text.format.type=json_schema` with those required fields. Transport acceptance therefore did not establish upstream schema compliance. No raw model output, personal context, credentials, or reasoning is part of this report.

The old validator combined all these failures into `Invalid structured planning decision`; generic failure recovery then scheduled another unchanged attempt. A syntactically valid but schema-invalid response can thus miss the 60-second materialization check independently of the unsupported singular-route issue above. No timeout limit was increased.

The candidate uses one schema definition for transport, model-visible instructions, and structural validation. It rejects missing/extra fields, invalid sizes/enums, malformed/truncated JSON, invalid verifier fields, duplicate/cyclic/unknown subgoal relations, and never coerces the alternative envelope into a plan. One corrective deep call supplies safe field-path/error-code feedback; both calls share the existing 90-second budget. Exhaustion suspends automatic planning, leaves criteria unaccepted, and publishes one conversational notice. Generic and lifecycle Resume do not reset the suspension; a new user request revision can recover the same parent.

`src/integration/native-faults.mjs` exercises actual HTTP admission, real installed Pi, rejected envelope -> changed corrective request -> materialized criteria, synthetic memory retrieval, substantive answer, separate answer verification, and verified completion. It also tests permanent invalid planning, one notice, resume fencing, and clarified-input recovery without adding another open parent. An optional loopback-only `PHUNBOT_NATIVE_DEEP_PROXY` bridges the synthetic planner request to the actual configured provider; the executor and verifier remain controlled fixtures, not real-world factual acceptance. This machine-specific bridge lives outside the product repository.

Production remains undeployed. After a separately authorized deployment, live acceptance must repeat the exact initial question, verify memory-grounded content without disclosing it in evidence, inspect accepted criteria and completion, and recheck malformed planning/verifier recovery. Isolated provider and browser results do not substitute for that gate.

## Deployment and rollback gate

No production restart/cutover is part of this change. Before a separately authorized deployment:

1. Preserve verified backups of current code/config, canonical Pi session files, execution/evidence state, conversation metadata and authoritative CalDAV tasks. Do not publish them. Record exact-source and adapter manifests.
2. Quiesce execution and ensure no old process can dispatch against the new code. Inventory legacy pending authorizations and `dispatching` control receipts; reconcile uncertain outcomes, never turn them into reusable grants.
3. Adopt the explicit transcript marker non-destructively. Supersede/re-propose legacy unbound authorizations; preserve their audit records and consumed/denied decisions.
4. Verify deployed source and built adapter identity, authenticated API health and real target behavior. Controlled fixtures do not replace production acceptance.
5. Roll back code independently of durable authority data. Never restore an old authority snapshot over newly consumed grants, new receipts or newer evidence. A rollback incompatible with the current authority schema requires stopping execution for operator reconciliation, not restoring permission to repeat effects.

Known limitations: uncertain dispatched controls require reconciliation rather than automatic retry; the sole-owner bearer remains the intended authority boundary; provider failures leave goals open; no real AMP mutation or live-production goal-creation latency is claimed; stacked predecessor PRs remain separate merge gates.
