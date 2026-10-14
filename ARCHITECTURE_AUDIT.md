# phunbot — Independent Architecture Audit

**Audit scope:** read-only review of the accepted baseline implementation at Unraid source commit `d410e08a8d32c5bdd71a338511c9ee49759544ba` (2026-10-14). No production code, permissions, containers, Hermes, ephunism, or n8n state was changed.

**Review publication:** sanitized source-only repository prepared locally at `/opt/data/phunbot-review`. GitHub publication was not possible in this environment because `gh` is not installed and no authenticated GitHub remote was available. The owner action is to create a **private** repository named `phunbot`, add it as `origin`, and push the prepared `main` branch. The publication commit is recorded in the final report after this document is committed.

## Executive assessment

The baseline is a coherent, security-conscious Node/Pi application rather than a universal agent replacement. Its strongest architectural decisions are sound: Pi remains the generic model/session harness; Nextcloud VTODOs are the structured goal authority; the Markdown vault is the human-readable memory authority; n8n is a bounded recurrence/recovery mechanism; MCP is the external capability boundary; and the controller independently verifies criteria instead of trusting assistant prose.

The most important gap is not ordinary goal admission. The application already routes substantive ordinary requests and explicit `/goal` requests through the same Nextcloud/controller path (`src/app.mjs:56`). The major gap is **durable autonomous execution beyond fixed resource windows**: the configured four-hour lifetime, model-turn budget, retry budget, and slice budget can mark a goal `resource_limit`, while the automatic resume path explicitly skips paused or exhausted checkpoints (`src/app.mjs:33-36,42`; `config/policy.json:9-18`). This preserves state but does not guarantee unattended continuation for many hours.

The second major gap is operational capability. AMP contains gated write tools in the vendored adapter (`src/vendor/amp/src/tools/operations.ts:90-220`), but deployed policy classifies non-read AMP operations as approval-only and the launcher defaults `AMP_ALLOW_WRITES` to false unless deployment-local settings enable it (`src/permissions.mjs:6-17`; `src/mcp-launch.mjs:9-14`). There is no reviewed, risk-tiered write policy or end-to-end authorized-write evidence. The current system is therefore useful for diagnostics and guarded approval requests, but not yet a demonstrated autonomous infrastructure manager.

The third major gap is the UI. It is a compact functional prototype, not a polished conversational client: messages are rendered with `textContent`, technical/tool content is flattened into the transcript, assistant text is displayed in cards, folders are labels without collapse state, and there are no Markdown rendering, copy actions, or icon-based message controls (`src/ui.js:3-5`; `src/index.html:1`). Improving the existing frontend is the lower-risk first option because the server API, transcript model, and browser tests already exist; adopting an established frontend should remain a later decision if interaction requirements exceed the prototype's maintainability.

## Baseline preservation and evidence boundary

Recorded before publication:

| Item | Observed value |
|---|---|
| Authoritative Unraid Git commit | `d410e08a8d32c5bdd71a338511c9ee49759544ba` |
| Baseline Git tree | Clean (`git status --porcelain` empty) |
| Live `/health` | `ok=true`, `name=phunbot`, `runtime=Pi` |
| Live app fingerprint | `a986f98c734c7e512a4a4a1b19e4a21e488080ec0e7e92ffd21f99f8cbe7edbe` |
| Reviewed controller fingerprint | `c3955b0c7a0812f5616c8c2ca5fdd61fd77d7817b3528b1fe715150b2c84cf1c` |
| Policy SHA-256 | `96264fdaca3621b54f0a51be7fd1b8a50372a58835be62d0accca914b84b296e` |
| Compose SHA-256 | `037874e9af2e8d0d5bfc42cf225d2d8a93ae39992d22db6eb022a5b12537633b` |
| Deployed workflow manifest SHA-256 | `57986d7f9c92194d547d88095f8b6db2919c9972476406b0f35d3dfbdccd1338` |
| n8n workflow | `xMqVJdNiwZWoPSdJ`, active, version `89993498-ef64-4a95-a5e3-98b0a0cd057e`, counter 7 |
| Source package | `@earendil-works/pi-coding-agent` 1.2.0, Node 22.19.0 target |
| Source tests | `npm test`: 94 passed, 0 failed, 0 skipped, exit 0 |

The 94 tests are deterministic source tests. They prove the tested seams and contracts only; they do not prove multi-hour unattended execution, production authorized writes, or complete UI quality. Existing baseline acceptance evidence remains in the authoritative Unraid tree and was not copied into the review publication.

The original Git history was inspected for secret-like material. Current-tree matches are fixture/configuration references, but historical matches include removed operational AMP scripts. A clean source-only publication history was therefore prepared instead of exposing the original history. The publication excludes `state/`, `cache/`, `work/`, `memory/`, `evidence/`, secrets, Pi provider configuration, runtime artifacts, the deployment CA, and dependencies. The n8n workflow was reduced to a sanitized template with credential bindings, webhook ID, and LAN host replaced by placeholders.

## Component and responsibility inventory

| Component | Source | Actual responsibility | Authority or boundary |
|---|---|---|---|
| HTTP application/server | `src/server.mjs`, `src/app.mjs` | Starts the service, serves UI/API, creates sessions, dispatches prompts, resumes goals | Runtime coordinator; not task authority |
| Pi integration | `src/app.mjs:2,25-27` | Pi model invocation, native session history, compaction, tool loop, MCP extensions | Generic harness |
| Admission | `src/admission.mjs:1-5` | Single-writer initialization/cancellation race control | In-memory request gate |
| Goal controller | `src/controller.mjs` | Criteria, evidence, blockers, checkpointing, settlement, cancellation, redaction | Enforces verification; Nextcloud remains state authority |
| Nextcloud adapter | `src/nextcloud.mjs:5-16` | CalDAV VTODO CRUD, ETags, certificate pinning, decoding | Authoritative structured goal state |
| Permissions | `src/permissions.mjs:6-39` | Tool classification, owner approval queue, one-use approval and expiry | Capability/risk boundary |
| MCP bridge | `src/mcp.mjs:1-9` | Memory and phunbot-local goal/n8n tools | Local standardized interface |
| AMP/Unraid launchers | `src/mcp-launch.mjs`, `src/vendor/amp/` | Spawn stdio adapters; AMP has read tools plus gated writes; Unraid package is launched from durable cache | External capability boundary |
| Memory | `src/memory.mjs:5-102` | Atomic Markdown notes, locks, revisions, links, secret-pattern rejection | Sole durable knowledge source |
| Semantic index | `src/index.mjs` | Derived embeddings and retrieval over Markdown notes | Cache/derived view, not authority |
| Memory maintenance | `src/memory-review.mjs`, `src/maintenance.mjs` | Bounded candidate review, relationship/contradiction suggestions, provenance-preserving updates | n8n-triggered procedure |
| Model routing | `src/routing.mjs`, `src/input-evidence.mjs` | Review-failure counters and model selection | Policy-controlled harness routing |
| UI | `src/index.html`, `src/ui.js` | Login, conversation list, folder/model controls, send/cancel/approval display | Browser client only |
| n8n | `config/n8n-workflow.template.json` | Five-minute resume, maintenance, deployed-revision guard, postcondition validation | Recurrence and reusable procedure, not reasoning loop |

## Actual request and execution lifecycle

1. The browser calls `POST /api/sessions/:id/send` with text and optional base64 image (`src/ui.js:15`; `src/app.mjs:56`).
2. `Admissions.reserve` prevents duplicate initialization and gives the request a generation check (`src/admission.mjs:2-4`).
3. If the request is substantive and no open goal exists, the app creates a Nextcloud goal. Explicit `/goal` only changes the stored request prefix and title; ordinary substantive requests use the same goal/controller path (`src/app.mjs:56`). Greetings are intentionally exempt.
4. `open` creates or restores a Pi session, loads MCP/tool-search extensions, and registers phunbot tools (`src/app.mjs:9-27`). The loader disables skills, prompt templates, and context files, then injects a bootstrap system prompt (`src/app.mjs:25`).
5. Before the model starts, semantic retrieval searches the Markdown-derived index and inserts notes as a hidden custom message (`src/app.mjs:22`). If embedding retrieval fails, lexical Markdown search is used.
6. Pi invokes native tools. `tool_call` checks cancellation, `Permissions`, work-path scope, shell denial, and repeated-failure fingerprints (`src/app.mjs:18`). Tool results are redacted and recorded as evidence (`src/app.mjs:21`).
7. The model must call `goal_plan`; the plan is independently reviewed before Nextcloud children are created (`src/app.mjs:12`, `src/controller.mjs:58-73`). `goal_verify` independently reviews actual evidence and persists criterion evidence only when the reviewer returns valid evidence IDs (`src/app.mjs:14`, `src/controller.mjs:76-83`).
8. `goal_blocker` independently reviews blockers; `goal_unblock` requires fresh evidence. `Controller.settle` only completes a parent when every planned child has verified evidence (`src/controller.mjs:87-100`).
9. Pi settlement and the outer continuation loop can send a controller message and another turn (`src/app.mjs:23,36`, `src/continuation.mjs:1-8`). The controller, not final assistant prose, decides completion.
10. A timeout, provider error, or slice abort enters reconciliation. Exact settlement is attempted first, then retry accounting and `retryable_error` are persisted (`src/app.mjs:5,37-40`). n8n later calls `/api/resume` and `/api/maintenance` according to the sanitized workflow template.

### Lifecycle strengths

- Ordinary requests and `/goal` share the same core architecture.
- Goal completion is evidence-based and protected against stale cancellation generations.
- CalDAV ETags, checkpoint atomic writes, redaction, failure fingerprints, and symlink/work-scope checks are real controls.
- Native tool evidence is separated from assistant assertions.

### Lifecycle gaps

- `driveContinuation` is an in-process loop, not a durable job scheduler. A process crash between turns relies on the next resume call and persisted state.
- `run` refuses to start when `cp.paused`, retry budget, model-turn budget, or lifetime budget is exhausted (`src/app.mjs:33`). `resume` also skips paused/exhausted checkpoints (`src/app.mjs:42`). This is the principal autonomous-execution defect.
- Internal controller messages are emitted with `display:true` (`src/app.mjs:23,36`), so execution machinery can appear in the user transcript unless the UI filters it.
- The application has separate catalog, Pi session JSONL, controller checkpoint, and Nextcloud records. The README correctly describes their intended roles, but reconciliation between all four is custom and only partly covered by integration evidence.

## Actual memory lifecycle

- `Memory` stores Markdown notes under the durable `memory/` directory, validates note IDs, rejects symlink roots/notes, uses per-note lock directories, preserves old content in `state/memory-revisions`, writes atomically, and requires title/body/source provenance (`src/memory.mjs:5-77`).
- `memory_link` adds reciprocal Obsidian links with an explicit inferred reason (`src/memory.mjs:88-100`).
- `before_agent_start` retrieves semantically similar notes; the vector index is rebuilt from Markdown and can fall back to lexical search (`src/app.mjs:22`, `src/index.mjs`).
- n8n invokes bounded memory review. The reviewer receives note pairs as data, may identify relationships/contradictions/redundancy, retries malformed output only within the configured bound, and does not merge notes automatically (`src/memory-review.mjs:3-23`).

This mostly matches the unified-memory intention. The remaining authority risk is behavioral rather than file layout: model-originated `memory_observe` and `memory_link` are classified as read-level phunbot capabilities (`src/permissions.mjs:9`), so they can write knowledge without an independent semantic review. That may be appropriate for immediate deliberate authoring, but the target architecture should define which writes are direct, which require review, and how identity/preference changes are confirmed. The separate `skills`/profile systems are disabled for the application (`src/app.mjs:25`), which avoids a second application memory authority; Hermes itself remains intentionally separate.

## Model routing and permission architecture

### Routing

Policy names `fleet-fast` as executor, `fleet-vision` as reviewer/vision, and `fleet-embed` for embeddings (`config/policy.json:2-7`). `recordReviewFailure` counts failures for plan/verify/blocker and switches to `policy.routing.escalationModel` after three failures (`src/routing.mjs:2-8`). The deployed escalation model is also `fleet-fast` (`config/policy.json:25-29`), so a default `fleet-fast` executor does not escalate to a meaningfully different model; the guard `selected===reviewer` prevents a same-model route, while a `fleet-fast-spark` selection can route to `fleet-fast`. This is a policy clarity issue, not evidence that fleet-fast itself is defective. The independent reviewer remains fleet-vision for the configured goal gates.

No source evidence establishes capability rankings for all fleet aliases. The UI lists discovered models returned by the runtime, but the policy only assigns role names. A future routing design should record demonstrated capability/latency/error evidence separately from model labels.

### Permissions

`classify` permits a narrow AMP read set, selected non-sensitive AMP config reads, selected Unraid read subactions, and phunbot memory/goal/n8n reads/writes. Resource passthrough and Docker are denied (`src/permissions.mjs:6-17`). Other AMP and Unraid operations enter exact owner approval, with one-use consumption, one-hour expiry, queue limits, and Nextcloud persistence (`src/permissions.mjs:19-39`).

The vendored AMP adapter has real gated write implementations with read-back or state checks (`src/vendor/amp/src/tools/operations.ts:90-220`). The launcher forces `AMP_ALLOW_WRITES=false` unless a deployment-local setting explicitly says `true` (`src/mcp-launch.mjs:9-14`). This is a useful safety default, but it is not yet the revised capability architecture: there is no source-level risk tier table for individual write operations, no owner decision policy distinguishing reversible routine writes from destructive changes, and no verified production write exercise. Enabling writes during this audit would violate the stop boundary and was not done.

The next design must preserve denial of arbitrary shell, Docker control, credential-bearing settings, SSH/public-ingress changes, and unrestricted filesystem access while adding explicit per-operation risk classes and postcondition/read-back verification.

## UI implementation assessment

The UI is functionally connected to the API and has evidence-backed browser tests for history, folders, models, attachments, cancellation, approval display, and persistence. It is nevertheless a prototype:

- `src/ui.js:3-5` renders every message with `textContent`; Markdown is not parsed, code blocks are not differentiated, and there are no message-level copy actions.
- The same code flattens tool calls into `Tool: <name>` text and exposes content without a collapsible technical trace model (`src/ui.js:5`).
- `src/index.html:1` uses card-like `.message` panels, prominent full-width sidebar buttons, plain text controls, no icon system, no folder disclosure state, and a wrapping composer (`flex-wrap:wrap`).
- Controller custom messages are requested with `display:true` (`src/app.mjs:23,36`), so internal machinery is not cleanly separated at the transcript source.
- The UI stores the bearer token in `sessionStorage` (`src/ui.js:1,6`). This is a reasonable private-LAN prototype choice but increases exposure to any future XSS; CSP is restrictive, but the target should consider a session cookie or short-lived CSRF-protected session.

Recommendation: improve the existing frontend first. The API already exposes stable session/message/approval operations and the browser tests provide a starting contract. Adopt an established frontend only if a prototype pass demonstrates that Markdown, trace disclosure, accessibility, responsive layout, and attachment UX would require replacing rather than extending this small client.

## Ranked discrepancies against revised requirements

### High — finite budgets can strand unfinished goals

**Evidence:** `config/policy.json:9-18`; `src/app.mjs:33-42`; `src/controller.mjs:99-100`.

A four-hour wall-clock budget, model-turn cap, retry cap, and slice timeout can set `paused='resource_limit'`. The automatic resume loop skips paused checkpoints and checkpoints at/above retry/model limits. The design preserves the unfinished goal but does not automatically resume it across hours. This directly conflicts with the revised requirement that finite budgets must not independently terminate or indefinitely abandon a goal.

**Required next-stage decision:** define durable budget semantics: per-slice budgets that release resources, persisted continuation leases, explicit external-blocker state, and a scheduler that can resume resource-paused work after strategy diagnosis without blindly repeating it.

### High — authorized infrastructure writes are not operationally demonstrated

**Evidence:** `src/permissions.mjs:6-39`; `src/mcp-launch.mjs:9-16`; `src/vendor/amp/src/tools/operations.ts:90-220`.

The adapter has gated writes, but deployed launch policy defaults them off and generic approval does not establish operation-specific risk controls or production write verification. Unraid non-read operations enter approval, but there is no demonstrated authorized write path in the source tests or baseline evidence.

**Required next-stage decision:** define risk tiers, approval payloads, safe operation allowlists, read-back/postconditions, timeout/retry semantics, and a non-destructive integration test matrix for AMP and Unraid. Do not enable unrestricted writes.

### Medium — internal execution messages leak into visible conversation semantics

**Evidence:** `src/app.mjs:23,36`; `src/ui.js:5`.

Continuation/controller messages are explicitly displayable and the UI renders them as ordinary content. This conflicts with the desired distinction between visible conversation and internal execution machinery and makes transcript UX depend on Pi custom-message behavior.

### Medium — memory writes are deliberate but not independently quality-gated

**Evidence:** `src/permissions.mjs:9`; `src/mcp.mjs:5-6`; `src/memory.mjs:68-100`.

The Markdown vault is the right authority and the write path is provenance-preserving, but memory observation/link operations are classed as read-level local capabilities. The system prevents obvious secrets and preserves revisions, yet it does not independently validate atomicity, identity correctness, or contradiction impact before significant knowledge is written.

### Medium — routing policy does not encode demonstrated capability evidence

**Evidence:** `config/policy.json:2-7,25-29`; `src/routing.mjs:2-8`.

The role map is explicit, but model aliases are not accompanied by durable capability/latency/error records. Escalation to `fleet-fast` is only a meaningful change for some initial models; it is not a distinct escalation path for the default executor.

### Medium — UI lacks the intended conversational rendering and accessibility contract

**Evidence:** `src/ui.js:3-16`; `src/index.html:1`.

Markdown, code-copy, compact action icons, collapsible folders/traces, integrated attachment UX, and responsive toolbar behavior are absent or only partially represented. This is a product-quality gap, not a baseline execution failure.

### Low — multiple persistence layers increase reconciliation burden

**Evidence:** `src/app.mjs:8-9,26`; `src/controller.mjs:41-56`; `src/nextcloud.mjs:12-16`.

Catalog state, Pi sessions, controller checkpoints, and Nextcloud tasks each serve a legitimate role, but the custom synchronization surface is large. This should be simplified only after invariants and recovery tests are written; deleting any layer now would risk losing a needed authority boundary.

## Verified behavior, untested assumptions, and recommendations

### Verified by source tests or live evidence

- 94 deterministic tests pass.
- Live health reports the Pi runtime and app fingerprint.
- Baseline acceptance is 18/18 named categories, with separate evidence acknowledging its limits.
- Goal plans, criterion verification, blocker review, cancellation, stale-generation protection, redaction, work scope, and many failure paths have direct tests.
- Memory writes preserve source revisions and reject obvious secret patterns; embedding index tests rebuild from Markdown.
- AMP write implementations exist behind `allowWrites`; deployed policy did not enable them during this audit.

### Not established by the current tests/source

- Automatic completion after more than four hours or after a persisted resource pause.
- Multi-hour crash/restart/compaction continuation with real external services.
- Authorized, non-destructive AMP or Unraid writes with owner approval and postcondition read-back.
- Fine-grained risk policy for all external operations.
- Browser accessibility, Markdown fidelity, copy affordances, folder disclosure, or responsive interaction quality.
- Fleet-wide capability ranking or meaningful escalation beyond configured aliases.
- Independent quality review of every significant model-authored memory mutation.

## Opportunities for simplification and consolidation

1. Keep Pi as the invocation/session/tool-loop implementation. Do not reimplement context management or model streaming.
2. Keep `Controller` focused on goal invariants and evidence; move long-lived continuation scheduling into a durable scheduler/lease layer rather than expanding controller turn logic.
3. Keep Nextcloud as the structured authority, but document a narrow reconciliation contract for catalog, session pointer, checkpoint, and task state.
4. Keep Markdown as the only semantic memory authority; treat embeddings and maintenance output as derived/cache state. Add explicit memory-write classes rather than another memory store.
5. Replace generic permission approval with a declarative operation registry containing risk tier, required owner scope, allowed arguments, postcondition, and rollback/retry policy.
6. Treat n8n as recurrence/event procedure only. The current workflow's revision guard, resume, maintenance, and validation responsibilities fit that boundary; do not move model reasoning into n8n.
7. Extend the current frontend before considering replacement. Add a transcript view model that separates assistant/user text, tool traces, controller events, and artifacts.

## Recommended target architecture

```text
Browser/API
   -> admission + durable execution lease
   -> Pi session/runtime (generic invocation and native tools)
   -> phunbot controller (goal invariants, evidence, continuation intent)
        -> Nextcloud VTODOs (goals, criteria, blockers, approvals, completion)
        -> Markdown vault (authored semantic knowledge)
             -> derived embedding index
        -> MCP capability registry
             -> local phunbot MCP
             -> AMP/Unraid adapters with operation risk tiers
   -> n8n recurrence/event procedures (resume, maintenance, validation)
```

The key change is not another framework. It is a durable continuation supervisor with explicit states separating `resource_slice_complete`, `waiting_dependency`, `waiting_owner_authorization`, `safety_blocked`, `cancelled`, and `verified_complete`. Resource release should be normal; only a diagnosed repeated-failure policy should stop unattended continuation.

## Proposed implementation sequence and tests

1. **Specify state/lease invariants first.** Model the lifecycle and generation/lease transitions; add unit tests for slice rollover, crash recovery, compaction, cancellation races, and multi-hour simulated time.
2. **Implement durable continuation scheduling.** Resume after resource slices and process restart; add a bounded strategy ledger so repeated failures change approach without duplicate side effects. Test with fake clocks and a real persistence backend.
3. **Define capability risk registry.** Map AMP/Unraid operations to low-risk/reversible/consequential/destructive tiers, exact argument constraints, authorization scopes, and postconditions. Keep writes disabled until tests pass.
4. **Add authorized-write integration tests.** Use disposable fixtures or a dedicated test instance; require owner approval, verify read-back, test timeout/retry/idempotency, and prove destructive operations remain denied.
5. **Harden memory authoring.** Preserve immediate deliberate writes, but classify identity/preferences/procedures separately and add independent review or owner confirmation where appropriate. Test contradictory updates and concurrent writers.
6. **Separate transcript presentation data.** Keep internal controller/tool traces available through collapsible inspection endpoints but exclude them from ordinary assistant text. Add API/UI tests for visibility rules.
7. **Improve the existing frontend.** Add Markdown renderer with safe URL policy, code-copy controls, icon labels, compact navigation rows, collapsible folders/traces, accessible attachment controls, and responsive composer behavior.
8. **Run long-duration and cross-boundary acceptance.** Exercise real process restarts, n8n resume, Nextcloud ETags, memory maintenance, model routing, and authorized writes. Publish evidence separately from source.

## Owner decisions required

- What maximum unattended elapsed time is acceptable, and should a resource slice ever become a terminal/pause state without an active supervisor lease?
- Which AMP and Unraid operations are low-risk enough for unattended execution, and which require per-operation explicit approval?
- Should memory observation/linking be direct model-authoring, independently reviewed, or split by knowledge type?
- Is the current private-LAN bearer-token model acceptable for the next UI phase, or should the service adopt a session-cookie/identity layer?
- Should `fleet-fast` remain the escalation executor, or should a distinct demonstrated escalation model be selected?
- Should the existing frontend be extended first (recommended) or replaced after a focused prototype comparison?
- Which n8n workflow fields may be published to the private GitHub repository, and which deployment identifiers should remain owner-local?

## Stop-boundary result

No revised architecture was implemented. No permission was enabled, no execution limit was raised, no container was restarted or recreated, no n8n workflow was changed, and no unrelated infrastructure was touched. The next stage should begin only after owner review of this document and the sanitized source publication.
