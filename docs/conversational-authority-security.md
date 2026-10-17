# Authenticated conversation authority

## Deliberate boundary change

PhunBot is a single-owner assistant. The existing web/chat bearer authenticates the owner. A request passing that backend authentication and same-origin checks may authorize an exact operation through an ordinary message. This is a deliberate expansion of the existing credential's authority, not multi-user RBAC or an assertion that a model is the owner. There is no second CLI, signing-key, or confirmation step. A holder of the bearer can approve operations; it must therefore be protected as an owner credential. This release does not create a public listener, change ingress, rotate credentials, or weaken TLS.

User-controlled JSON cannot declare itself authenticated: the HTTP handler derives the trusted context only after checking the Authorization header. Tool results, retrieved documents, assistant output and custom messages never enter the user-message approval path. Native shell is prohibited and file operations remain confined to the work directory; model tools cannot read the web bearer or write the authority store.

## Exact operation boundary

A proposal records its goal, conversation, goal revision, tool, exact arguments/effect fingerprint, registered effect/risk and request identity. It is presented as a question in chat, including target, arguments and expected impact. An unambiguous authenticated yes/no is bound to that proposal. Multiple pending operations require clarification; an ambiguous yes grants nothing.

The backend reclassifies the operation and checks current policy, secure AMP transport and configured instance scope. Unknown operations are prohibited, not made approvable by default. Existing policy prohibitions remain prohibitions. In particular, Docker/raw control-plane passthrough, credential/authentication changes and unsafe paths remain unavailable.

Before a consequential dispatch, the backend checks open/unpaused goal state, revision, effect/risk and approval expiry. It consumes the authorization using the authoritative CalDAV ETag before dispatch. A conflicting consumer fails closed. Consumption is not reversed on an uncertain external result: this is **at-most-once dispatch**, not a promise that a remote side effect is transactionally exactly-once. Read-only outcome verification must resolve uncertain results; the assistant cannot blindly reuse a consumed grant.

Reusable legacy owner scopes no longer bypass one-use approval. Legacy signed exact decisions are retained for audit/compatibility, but never required by the chat path and never valid across a changed goal revision. New or changed user intent supersedes pending/approved grants without deleting their audit records.

## Control turns and replay

Each user control has a durable request identity bound to the conversation **and goal**. Controls and ordinary admission acquire the same conversation-level CalDAV CAS lease, then check both control and ordinary receipts across all current and terminal goals. IDs cannot change meaning or target a later goal after restart. Direct Goals lifecycle endpoints acquire that same admission lease before mutation.

A control reserves its identity on the existing goal. Immediately before invoking any effect it rechecks the admission lease and reservation token/expiry, then CAS-transitions the reservation to an irreversible `dispatching` phase. A `dispatching` reservation is **never reclaimed**, even after expiry. A slow old handler and a replacement cannot both dispatch. A crash or lost result at this boundary returns 409 on retry and requires reconciliation of authoritative state; it does not blindly re-run the effect. This deliberately chooses at-most-once safety over automatic recovery of an uncertain operation.

A matching completed request is replayed from its authoritative receipt. Receipts contain a bounded outcome, not recursively nested goal snapshots or authorization material. Transcript output uses a stable canonical output key so a retry can repair missing publication without reactivating execution. Terminal goal states remain irreversible and controls never create an additional open parent.

## Read-only Unraid routes

The installed typed MCP schema and dispatch behavior were inspected, rather than assuming that names imply safety:

- `system/array`: registered state query.
- `array/parity_status`: registered read; live read succeeded during investigation.
- `live/array_state`: registered read/subscription; classified read-only. The separate currently connected MCP returned a missing `rich.traceback` dependency during a live probe. That is an integration/runtime diagnostic, not evidence that approval is required.
- `array/array`: **not a registered subaction** in the inspected runtime; a live call returned the exact supported-subaction error. It is not broadly whitelisted as an invented alias.

Unknown array/live operations and mutations do not inherit these read permissions.

## Release and migration safeguards

Production data is not rewritten or cleared. Existing canonical Pi records are preserved. Presentation adoption appends a visibility-policy marker; it does not edit historical messages. Old authorization requests without current revision/target binding must be superseded and freshly proposed, not retroactively approved.

Migration and rollback are an explicit reviewed deployment gate: back up app configuration, canonical sessions, executions and CalDAV state; record exact source manifests; stop execution before changing runtime code; validate existing pending grants; then verify source identity and read-only health. This PR alone does not authorize a cutover. A rollback must never resurrect consumed grants or erase newer authorization receipts/evidence; restore code independently of durable authority data.
