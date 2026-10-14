# phunbot

**Release status: tested baseline accepted (18/18 categories). Hermes remains the primary assistant; replacement and architecture review are separate.**

The deployed service is LAN/private-network only. Deployment credentials and provider authentication are intentionally omitted from this review repository. No credentials are embedded in this document or Git.

## Exactly five authorities

| Concept | Implementation | Authority |
|---|---|---|
| Harness | Pi SDK `@earendil-works/pi-coding-agent` 1.2.0, Node 22.19.0 | Model invocation, native tool loop, sessions, compaction and execution |
| Goals | Dedicated Nextcloud user `phunbot`, CalDAV VTODO collection `phunbot-goals` | Goal, acceptance-criterion, blocker, cancellation, approval and completion state |
| Memory | Independent `memory/` Markdown vault | Identity, preferences, observations, relationships and procedures |
| Workflows | Existing n8n, workflow `xMqVJdNiwZWoPSdJ` | Recurrence and maintenance/recovery triggers |
| Tools | Native Pi MCP extension; phunbot, AMP and Unraid stdio servers | Scoped external capabilities |

There is no separate skills repository, vector-memory authority, task database, scheduling daemon, proxy or agent framework. The browser is a small custom interface, not another agent runtime. Pi's skill/context-file loading is disabled for this application; bootstrap instructions identify the vault and goal tools rather than duplicating persistent knowledge. Hermes remains separate and was not replaced.

## Persistent layout

The deployment mounts a durable data root and the application source read-only; exact host paths and credentials remain deployment-local.

- `src/`: application source, tests, lockfile and preserved AMP adapter source.
- `config/compose.yaml`: exact deployment, LAN port, user, mounts, resource bounds and durable Unraid icon.
- `config/policy.json`: model roles, routing and execution/maintenance limits.
- `config/pi/agent/`: existing Pi/provider installation and configuration.
- `config/secrets/`: private service references and credentials; excluded from Git.
- `memory/`: authoritative Markdown vault, directly readable by a human and compatible with Obsidian links. No second nested vault root.
- `state/pi-sessions/`: canonical Pi JSONL conversation history.
- `state/conversations.json`: UI catalog and stable execution/session pointers, not a second message store.
- `state/executions/`: execution counters, failures, evidence UUIDs and checkpoints, not authoritative task completion.
- `state/memory-revisions/`: preserved pre-edit Markdown.
- `state/source-backups/`: pre-deployment rollback snapshots.
- `cache/`: rebuildable embeddings, review caches, MCP runtime dependencies and managed Python cache.
- `work/`: scoped agent artifacts; native file tools cannot access configuration, secrets, harness files or arbitrary host paths.
- `evidence/`: real acceptance outputs, failures, source manifests, reviews and release reconciliation.

This repository is a sanitized source-only publication prepared for independent architectural review. The authoritative deployed source remains the private Unraid repository until explicitly changed.

## Deployment and reload boundary

The persistent requested container is named `phunbot`, uses `node:22.19.0-bookworm-slim`, runs as UID/GID 10000, has a 2 GiB memory limit, two CPUs, a PID limit of 256, drops capabilities and uses `no-new-privileges`. It has no raw Docker socket or broad host/share mount. The command is `node /app/server.mjs`, not a development file watcher. An explicit restart is therefore required after source/config changes.

**Loaded app fingerprint:** `a986f98c734c7e512a4a4a1b19e4a21e488080ec0e7e92ffd21f99f8cbe7edbe`.

**Reviewed controller fingerprint:** `c3955b0c7a0812f5616c8c2ca5fdd61fd77d7817b3528b1fe715150b2c84cf1c`.

The current source passed 94 deterministic tests and independent review. App changes reconcile timeout status with exact canonical completion and require independent image evidence review. The controller permits successful inventory evidence alongside two distinct real safety denials without accepting prose, self-authored logs, unknown references or unreviewed supplemental evidence.

After the owner restart, fresh native safety testing exercised that corrected mixed-evidence path. The authoritative parent remained NEEDS-ACTION with an independently reviewed safety blocker; runtime became blocked and idle. An unchanged app-only fingerprint would not prove a controller-only reload; the observed changed behavior supplies functional deployment evidence. Copying files or HTTP 200 is not deployment proof.

The existing n8n app-revision guard admits the reviewed app. Saved scheduled runs demonstrate actual dependency recovery and memory maintenance, with bounded reviewer failures preserved and subsequent successful schedules read back. No additional Docker operations or workaround containers were used after the task's administration limit. No further owner restart is required for this baseline.

## Models and routing

Provider: the existing LiteLLM-compatible endpoint `http://100.112.208.5:4000/v1` over the Tailnet. Discovery returned 17 fleet aliases. Interactive selections are restricted to five actually discovered, tool-tested entries: `fleet-fast`, `fleet-fast-spark`, `fleet-deep`, `fleet-vision`, `fleet-code`. Specialty catalog entries are not advertised as verified interactive capabilities merely because their names suggest a role.

Configured roles:

- Executor: `fleet-fast`.
- Independent plan/result/blocker/memory reviewer: `fleet-vision` (separate invocation/context).
- Image input and visual verification: `fleet-vision`.
- Embeddings: `fleet-embed` (actual 1024-dimensional responses).
- Escalation executor: `fleet-fast` after three consecutive rejected planning, verification or blocker proposals by a weaker selected model. Same Pi session and Nextcloud goal; no second framework. Text escalation is suppressed for goals with images.

`fleet-deep` remains selectable but is not the automatic escalation target: native provider errors and malformed verdicts were observed. `fleet-fast-spark` was fast in simple tests but repeatedly failed to reformulate difficult plans/blockers. Context-window/capability placeholders in provider discovery are not independently established model limits. Roles and limits are explicit in policy configuration; changes require reload.

## Goal behavior

Use `/goal <request>` for an explicit persistent goal. Other substantive requests use the same Nextcloud/controller architecture; short greetings/acknowledgements need not create tasks.

The controller requires a reviewed measurable plan, creates stable child criteria in Nextcloud, executes through Pi, and verifies each criterion. `file_contains` checks actual scoped artifact bytes and stores a hash. `evidence_review` invokes an independent reviewer and requires references to actual recorded evidence UUIDs. Assistant assertions cannot prove external state. Actual expected rejection errors may prove a denial; fabricated files or success prose cannot prove an infrastructure operation.

A text-only final response cannot end unfinished work. Native settle hooks and an outer continuation driver both inspect Nextcloud. Repeated identical failures are guarded; rejected planning/verification/blocker proposals can trigger configured model escalation. Container startup and n8n recurrence can resume eligible unpaused goals. Substantiated dependency blockers require fresh evidence and independent re-review before clearing. Owner-only authorization/information/safety boundaries are not silently waived.

Current configured limits: 80 controller turns, 80 model turns, four hours total wall time, ten-minute execution slices, three provider/slice retries, two concurrent goals, three cached runtimes and 8192 native output tokens. Resource exhaustion preserves unfinished task state. Cancellation persists CANCELLED and prevents stale completion from overwriting it. Do not clear a paused checkpoint or raise limits without inspecting the evidence and choosing a meaningful recovery strategy.

## Permissions

AMP starts read-only by default. Sensitive reads and consequential Unraid/AMP actions require an exact authenticated owner decision, stored in Nextcloud and consumed once with expiry. A browser approval does not create an unsupported downstream capability: an AMP write still fails while that adapter is read-only. Docker control, credential/SSH/public-ingress operations, unrestricted shell, infrastructure resource passthrough and unknown MCP namespaces remain denied. Full AMP backups are not automatic.

Use **Approvals** to inspect a requested exact tool and arguments, then approve once or deny. No dangerous infrastructure mutation was used to make a demonstration look successful.

## Memory and n8n

The initial bootstrap vault had 21 readable Markdown notes; current totals evolve through provenance-preserving writes and are recorded by maintenance. Embedding rebuild from scratch read 21 authoritative notes, created 21 records with 1024 dimensions, matched source hashes and retrieved relevant goal-authority knowledge. Temporary rebuild output was removed. Source notes, human links and historical revisions are preserved; inferred reciprocal links have explicit provenance. Ten historical validation notes were annotated so they are not promoted into current capability facts. `ephunism` was not read, migrated, indexed or modified.

Maintenance is incremental and bounded: changed-note embeddings, candidate semantic pairs, LLM relationship assessment, reciprocal links, contradiction/atomicity/redundancy suggestions. No automatic destructive merge/split is claimed. The broad-review option exists; the production recurrence is incremental, not an independently scheduled memory framework.

n8n workflow `phunbot — Recovery and memory review` runs every five minutes in `America/Denver`, and exposes a supported authenticated verification webhook. It checks the loaded revision, invokes `/api/resume`, invokes `/api/maintenance`, then validates result fields. It preserves saved success/error execution records. Malformed reviewer output fails after bounded retries; a workflow error cannot complete a Nextcloud goal. Post-reload scheduled executions demonstrate actual dependency recovery and memory maintenance. Malformed provider output can still fail a bounded run; later schedules recovered without weakening validation or adding another scheduler.

## Browser operation

1. Open the LAN URL and connect with the existing private web token; do not post the token in chat or source.
2. Create/select a conversation in the sidebar. **Move to folder** organizes history without copying messages.
3. Choose a discovered model. For an image attachment choose `fleet-vision`; supported browser formats are PNG/JPEG/GIF/WebP, under 5 MB.
4. Send an ordinary request or `/goal ...`. Execution runs on the server; the browser can close.
5. Inspect execution state, tool results, **Approvals** and **Cancel**. A paused/blocked/cancelled goal is not completed.

History/model/folder/approval controls passed real browser tests. A fresh isolated image test uploaded a red-background/blue-square PNG, independently verified the answer against pixels, completed the canonical goal, and preserved the attachment and history after reload with zero JavaScript errors. The earlier combined fixture exceeded its fleet-vision wait and attempted an image send while that conversation remained busy; its failure is preserved. All five selected models eventually produced final replies, verified separately from that failed fixture exit. Privileged approval consumption was not exercised by the approval-panel test.

## Maintenance, testing and rollback

- Run the deterministic gate from the source directory: `npm test`. Do not shorten test output through a pipeline that hides failures.
- Preserve code, policy and workflow versions before changes. Dependencies are replaceable from lockfiles; retain the pinned MCP adapter versions and source.
- Run generic tests without copying credentials into test fixtures, output or Git. Browser validation may use an already installed Chromium via a test-only path override.
- Verify the loaded `/health` fingerprint after a requested restart, then run current-source native/browser/n8n tests. Read Nextcloud/task and n8n execution state back; do not trust model success prose or write acknowledgements.
- Inspect private startup/extension/MCP diagnostics in `state/`; avoid publishing user prompts or credentials. Restore source backups and the saved workflow version when rollback is needed, then reload explicitly and verify again.
- Keep the revision guard synchronized with an independently reviewed accepted deployment; do not bypass it merely to obtain a green workflow.

See `REPORT.md`, `evidence/acceptance.json` and the evidence paths listed there for the complete pass/partial/not-run reconciliation. These records distinguish tested baseline behavior from broader Hermes replacement and the separate architecture/simplification review; neither is implied by baseline acceptance.
