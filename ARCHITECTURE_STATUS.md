# Architecture revision — release preparation, not acceptance

This repository is the canonical application implementation. Development, review, tests and any authorized deployment must use the same version-controlled source, not a separately sanitized private fork. Runtime configuration, credentials and operational data remain private and separate.

## Responsibilities reviewed

- Pi owns model execution and canonical conversations.
- Nextcloud Tasks owns request, goal, criterion, coordination and lease state with ETag/CAS updates.
- Per-conversation admission and durable request identity prevent retries from silently amending another request; independent conversations may execute concurrently.
- Bounded slices yield without abandoning a goal. Provider failures back off, preserve identity/evidence and trigger strategy diagnosis. Cancellation and stale leases fence subsequent dispatch and verification writes.
- Completion requires the exact criteria and accepted verification receipts. An assistant assertion is not evidence of an external effect.
- Native/MCP capabilities are checked before dispatch. Privileged AMP writes additionally require explicit management policy, secure transport and independently signed exact or narrowly scoped owner authorization. Ordinary chat cannot approve them; chat denial/cancellation is deliberately non-privileged.
- Markdown is the sole durable semantic memory source. Immediate learning is independently reviewed pre-write admission. Retrospective consolidation binds source IDs, rejects unsupported observations, preserves manual/canonical bytes and checkpoints bounded review under a lock.
- n8n provides scheduled awakenings through authenticated APIs, not a second execution/state store. The published template is inactive and guards candidate identity before dispatch.

## Demonstrated defects corrected

| Area | Defect | Correction and evidence |
|---|---|---|
| Nextcloud transport | Deployment-specific Host/calendar identity; certificate pin was previously treated as identity verification | Host comes from configured URL; calendar is runtime-configured/encoded; CA-chain and hostname validation are mandatory; an explicit optional leaf pin is additive. TLS fixtures cover DNS/IP connection identity, hostname/pin failures and a CA-signed leaf. |
| AMP source parity | Launcher used an independent mutable runtime-cache adapter | Launch the built adapter beside the reviewed source. Actual launcher regression places different cache/source fixtures and proves source selection. |
| Upload boundary | Blank upload-root entries resolved to the working directory before filtering | Trim/filter blank entries before resolution. Regression reproduces the unintended authorization with a controlled working directory, then verifies no effect handler runs. |
| Authorization | Raw shell was classified as read; malformed AMP instance scope disabled scoping | Shell is denied in capability classification; invalid instance-scope shapes fail closed. |
| Completion | An invalidated parent with accepted criteria could settle as complete | Settlement now rejects `invalid` authoritative goals before completion. Regression observed premature completion before the fix. |
| n8n credential handling | Workflow listing could follow redirects carrying a custom API-key header | Validate configured URL, reject credential/query/fragment/plaintext non-loopback endpoints and disable redirects. Two loopback endpoints reproduce leakage before the fix and prove no redirected request after it. |
| Source identity | AMP manifests/source and Git identity missing or incorrectly scoped; startup-only health hid drift; incomplete CLI | Deterministic allowlisted manifest, exact HEAD, source-only dirty applicability, separate built-adapter identity, safe CLI, current-disk health and symlink/privacy regressions. |
| Publication examples | Workflow export retained ownership/version metadata, active flag and a stale app-only guard; Compose retained host labels/paths | Inactive generic workflow template with full candidate identity gate; runtime-supplied source/data paths and no host-specific labels. |

## Verification scope

Current commands/results and the final source manifest are recorded in the PR review receipt for the exact published revision. Earlier development counts and live-service claims are not reused as acceptance evidence. Run instructions are in `README.md`; manifest semantics and limits are in `docs/source-verification.md`.

Independent focused implementation reviews covered lifecycle/concurrency, authorization/TLS, memory/private storage and final source-identity/security changes. They are development reviews, not owner acceptance of the final published revision.

## Explicit limitations

- An external request already in flight cannot be undone by lease revocation or cancellation. Subsequent dispatch/results/verification are fenced, but there is no universal server-side fencing or exactly-once guarantee across all infrastructure APIs. Authorized mutation testing must verify the actual target's behavior and rollback semantics.
- Atomic local checkpoints and in-process controller locks are not cross-process checkpoint CAS. Run one application writer per runtime data root; Nextcloud CAS does not make two independent local checkpoint writers safe.
- Recovery between process restarts depends on an approved scheduler invoking resume. A template or unit test is not evidence of a real candidate n8n awakening.
- Filesystem hashes are observations, not loaded-process attestations; mutable dependencies and external toolchains are outside the application-source hash. Quiescent immutable builds and separate dependency/build receipts remain necessary.
- Current-tree sanitization does not erase previously published Git history. History scanning found credential-shaped test material and exported operational ownership metadata in earlier public commits. The current tree removes these; historical credential validity cannot be established by static scanning, and history rewriting/credential-response decisions require owner handling.

## Remaining release gates

1. Independent review of the final published revision and resulting fixes.
2. Explicit authorization for a disposable AMP mutation/readback/rollback test.
3. Explicit authorization for isolated candidate n8n awakening through an approved path.
4. Explicit authorization for production deployment and exact-source verification.
5. Authorized live rollback and durable-data preservation validation.

No production restart, deployment, real AMP mutation or production workflow change is part of this preparation. Automated tests do not close these gates. No telemetry or UI redesign is included.
