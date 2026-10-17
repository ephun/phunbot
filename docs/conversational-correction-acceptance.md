# Conversational authority correction — acceptance contract

Latest owner correction: **retain Goals Pause/Resume/Cancel/Complete controls**. Remove only authorization controls and owner-command ceremony. Conversational lifecycle remains available.

## Provenance and boundaries
- Published PR #4 head inspected: `763e1438703b15f17a2de478f8e359c8ca39c390` (open, stacked on PR #3).
- Earlier live `/health` reported no source drift; deployed source SHA-256 `b98d808aebcec8eff2b90f3adf8a44b78b9e49ccafd8ac6a8e31692ab0172949`; app `01fa9c8e61d875ef07f54ab74b5862ac68bac90aad657721d8ebe2c2bbf35fb4`.
- Six on-disk hotfix deltas reconciled on top of PR #4 in baseline commit `8dd6a70`: controller, outcomes, planning, UI read models, CSS, UI.
- Existing `/opt/data/phunbot-ui` dirty work left unchanged. Development continues in the existing separate worktree; no restart of the project.
- Production canonical session/execution/conversation records privately snapshotted with hashes outside this repository; never publish them. Production is not changed by this PR.
- No production cutover authorized; passing isolation tests is not production acceptance.

## Executed isolated regression evidence

Checked items below mean **verified on the integrated candidate in isolation**, not deployed production acceptance. Fresh full runs passed on both **Node 22.19.0** and **Node 26.5.1**. Application tests: **310/310 passed, zero failures/skips**. AMP: **35/35 passed** and build passed. Native Pi: all nine checks passed. Browser acceptance, UI smoke, prototype geometry, image comparison and sidebar checks passed. Source bytes were unchanged before/after this run. Private evidence is retained outside the product repository under `phunbot-correction-evidence/resume-final`.

- [x] 1. Authenticated yes authorizes exactly one pending exact operation without a CLI key.
- [x] 2. Authenticated no denies the operation; no silent reproposal.
- [x] 3. Ambiguous approval asks which operation in ordinary chat.
- [x] 4. Tool/retrieval/assistant approval spoofing cannot supply user authority.
- [x] 5. Duplicate/replayed user request cannot execute or authorize twice; expired control dispatch is fenced and cross-goal replay rejected.
- [x] 6. Changed target, consequences, or goal revision fences approval.
- [x] 7. Verified Unraid reads need no approval; unsupported aliases/unknown actions fail closed.
- [x] 8. Goals has no authorization management controls; lifecycle controls remain.
- [x] 9. Ordinary Pause/Continue/Cancel/We're done use deterministic backend transitions; direct lifecycle routes share conversation admission locking.
- [x] 10. Internal intermediate assistant text and reasoning absent from normal transcript.
- [x] 11. Intentional user-facing answers/questions remain visible; historical canonical records untouched.
- [x] 12. Verification failure attempts are bounded and diagnosable; Resume does not reset the unchanged malformed-verifier suspension.
- [x] 13. Durable evidence survives diagnostic churn and remains selectable.
- [x] 14. Useful supported answer can be delivered despite auxiliary verifier failure, without false completion.
- [x] 15. Control turns never create extra parents or resume unauthorized work.
- [x] 16. No empty response bubbles or orphan Copy controls; desktop/mobile geometry preserved.
- [x] 17. Exact initial question “What do you know about me?” reaches real HTTP admission, strict deep plan materialization, synthetic memory retrieval, substantive answer, independent fixture verification and verified completion.
- [x] 18. Malformed initial deep planning gets one changed corrective request, then suspends with one conversational notice; generic/lifecycle Resume cannot repeat unchanged planning. Clarified user input recovers the same parent.
- [x] 19. Configured `litellm/fleet-deep` through Pi Responses exercised the isolated native admission scenario, including the exact initial question. Executor/verifier remain controlled fixtures; no private user context or real AMP mutation is claimed.

## Release gates
- [x] Full application suite, including memory and telemetry.
- [x] AMP tests and build.
- [x] Native Pi fault integration.
- [x] Browser acceptance, prototype geometry and static UI smoke.
- [x] Independent authority/security and correctness review resolved for this exact candidate (fresh read-only review: no security concerns or logic errors; reviewed source-file hashes matched the frozen candidate).
- [x] Sanitized reviewable PR published: [PR #5](https://github.com/ephun/phunbot/pull/5), stacked on PR #4. Exact integrated source/test hashes recorded below; implementation commit `4fbeaaa35717ca884be1db679afa662304576770` was read back as the published head before this checklist-only update.
- [x] Migration and rollback instructions ready; no live history edits.
- [ ] Separately authorized deployment and live acceptance: exact initial question, actual relevant-memory answer, accepted criteria, verification/completion, operation-specific chat authorization, malformed planner/verifier recovery, and target screenshots. No production restart/deployment has occurred in this correction.

Candidate source SHA-256: `eba1f13514871db5a8784e63e181020b02acb48ad3b62d8c31c86edf7c2c05be`. AMP built-runtime SHA-256: `270129572b40c83dd534b33d79a52cd0265777dedaea788a4894454d8467eb4d`.
