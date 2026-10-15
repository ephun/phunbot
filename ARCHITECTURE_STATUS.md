# Architecture revision — review candidate

This branch is for independent source review. **It is not release acceptance and has not replaced the production baseline.** The earlier `ARCHITECTURE_AUDIT.md` describes the public baseline and remains historical review context.

## Responsibilities

Pi owns model execution and canonical sessions; Nextcloud Tasks owns request/goal/criterion state; Markdown owns durable semantic knowledge; n8n owns scheduled awakenings; MCP/native tools provide scoped capabilities. No parallel knowledge store or new agent framework was introduced.

- Durable request admission and CAS leases distinguish conversations, requests, goals and bounded attempts. A normal slice yield is not a failure or lifetime terminal state. Temporary failures back off; repeated ineffective strategies receive diagnosis instructions.
- Outcome contracts allow proportionate answers and deterministic arithmetic without fabricated tool evidence. External effects still require fresh evidence and independent verification. Parent acceptance receipts fence stale criterion publication.
- Declarative operation classifications and independently signed local owner decisions constrain privileged AMP effects. Ordinary chat bearer credentials cannot approve those effects. Write registration requires explicit policy and secure transport; authorization is not inferred from a tool name or retrieved note.
- Immediate knowledge admission is explicitly a **pre-write** review, not evidence that storage has already occurred. The actual request and bounded observations are supplied independently. Appends preserve manual Markdown and revisions.
- Retrospective consolidation reads canonical session records without migrating them, binds source IDs to permitted records, rejects untyped mutation-result laundering, and checkpoints bounded reviews incrementally under a lock. Relationship candidates are evaluated rather than linked automatically.
- The browser projects canonical Pi history into conversation and collapsible diagnostics; it is not another message store. Markdown, icons, copy controls, folders, attachments and narrow-screen navigation have browser tests.

## Confirmed corrections during validation

The captured maintenance HTTP 400 came from an invalid upstream embedding model name. Provider discovery supplied the display label `fleet-embed (incomplete metadata)`; the embeddings request must send the configured API ID `fleet-embed`. A regression test now checks that distinction. This was not diagnosed from HTTP status alone and was not a missing Nextcloud-fixture assumption.

A clean checkout also exposed missing pinned browser dependencies in the manifests. The lockfile now includes the locally served Markdown/sanitization/icon/digest libraries. Browser screenshots wait for the actual mobile-sidebar geometry instead of capturing the beginning of its animation.

## Verified development checks

- Application suite: **180 tests pass**, including an independent run on Node 22.19.0.
- Vendored AMP adapter: **33 tests pass**, TypeScript build passes.
- Isolated real browser: **20 checks pass**, no JavaScript errors. Desktop/mobile screenshots in `docs/screenshots/` contain controlled fixture content only, not private conversations or operational history.
- Actual Pi/provider and isolated Nextcloud learning: immediate note storage, subsequent semantic retrieval with 1024-dimensional vectors, selective retrospective authoring, canonical-session byte preservation, and original-note preservation passed.
- Real isolated service SIGKILL/restart: five controlled execution slices, same goal and criteria, prior evidence preserved. This uses a controlled executor with real isolated Nextcloud, not a claim of a live provider restart.
- Controlled HTTP executor-failure injection demonstrates backoff and same-goal recovery. It is not a claim that a real upstream outage was induced.
- Isolated baseline → candidate → rollback process smoke preserves manual-memory/checkpoint fixture hashes. It is not a production deployment or Docker-lifecycle test.

Private logs, task identities, source-machine paths, provider configuration, runtime data and credentials are deliberately excluded. Source sanitization changes deployment-specific host/path literals to examples; private and public commits are distinct histories.

## Open release gates

1. Independent review of this PR and any resulting fixes.
2. Explicitly approved disposable AMP instance and safe mutation/readback/rollback scope for an actual authorized infrastructure demonstration.
3. Authorized production transition and exact-source verification; production remains unchanged.
4. Actual n8n awakening of the candidate through an approved reachable path. The existing production workflow remains pinned to its accepted baseline; configuration readback is not candidate execution proof.

The credential-free `node integration/native-faults.mjs` suite also passes against actual native Pi and a controlled loopback HTTP provider/Tasks fixture. It verifies bounded 503 failure/backoff followed by same-goal recovery, cancellation of a held native response followed by a real service-process SIGKILL/restart, and denial of a consequential native tool before its effect handler runs. The controlled provider and Tasks fixture remain alive while the actual application process restarts. This is not an induced live upstream outage or an actual AMP mutation.
