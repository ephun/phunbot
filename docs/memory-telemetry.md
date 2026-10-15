# Native observational memory telemetry

## Boundary

`Memory` records activity automatically. No logging instruction, model decision,
new service, graph store or visualization is involved. Markdown remains the
knowledge source; embeddings and review caches remain replaceable. Search scores,
rankings, prompts, consolidation decisions and tool return values are unchanged.

Runtime events live at **`<PHUNBOT_ROOT>/state/memory-telemetry/observations.jsonl`**,
outside the Markdown vault. `PHUNBOT_ROOT` is private runtime storage (normally
`/data`), not this source checkout. Never point it at a published repository.
Directories are descriptor-anchored, symlinks are rejected, journal files are
mode `0600`, and newly created directories are mode `0700`. Back up this directory
with the existing private `memory/` and `state/memory-revisions/` data. Do not
commit real journals or publish them as PR evidence. Only synthetic examples
belong in source control.

## Schema version 1

One UTF-8 JSON object and newline per record. Common fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Integer `1` |
| `eventId` | Random UUIDv4; identity of this observation, not a note |
| `observedAt` | UTC ISO timestamp when the boundary was observed, not model cognition time |
| `operation` | One of the operations below |
| `outcome` | `observed`, or `failed` for `operation_failed` |
| `context` | Optional `sessionId`, `goalId`, and fixed `phase` label, omitted when unknown |

Phases are `agent`, `immediate`, `retrospective`, `maintenance`, `mcp`, and
`reconciliation`. IDs are bounded identifiers, not copied prompts or provenance
sentences. Async-local scoping prevents concurrent goals from exchanging context.
No session or goal is invented when the MCP server or maintenance job lacks one.

Note references use `{ "id": "synthetic-note", "version": "<64 hex SHA-256>" }`.
The stable identity is the existing vault filename ID; this does not introduce a
new organizational identity system. The version hashes exact UTF-8 Markdown.
Deletion and missing reconciliation observations use `version: null`. Recreating
the same ID is a new `create` observation; it does not invent a parent version.
An owner rename is not automatically treated as conceptual identity continuity.

| Operation | Additional metadata and interpretation |
| --- | --- |
| `create` | One note; `previousVersion: null` |
| `revise` | One resulting note, `previousVersion`, `preservedRevision` |
| `supersede` | Actual explicit supersession mutation, resulting note, old version/revision, `successorId` |
| `delete` | One null-version note, deleted version in `previousVersion`, preserved revision |
| `write_unchanged` | One existing version; no new version or parent edge |
| `read` | One version actually read by the interface; **not** proof it entered model context |
| `enumerate` | Versions read by `Memory.list`, including index rebuild/maintenance enumeration |
| `search` | `mode: lexical` or `semantic`; result note IDs/versions with 1-based ranks and numeric scores |
| `context` | Contributing note versions/ranks, `includedChars`, `truncated`, and aggregate `suppliedChars` |
| `relationship` | `source` note/version, `targetId`, `kind`, `action`, `assertionHash`, optionally previous kind/hash |
| `operation_failed` | Fixed `failedOperation` and error class (`not_found`, `rejected`, `io`), never error text |
| `reconcile` | Current snapshot, expected version and state for each identity; an observation of drift, not a fabricated mutation |

Result, context, enumeration and reconciliation lists are split into batches of
at most 100 note references. `batchId` groups them, `batchIndex` is zero-based,
and `finalBatch` marks the final part. Ranks remain global across the result set;
a missing final batch indicates incomplete capture, not an empty remainder.
Co-retrieval can be derived from one search batch group. Ordered journal records,
timestamps and available context IDs support access-frequency and observed
transition analysis. None proves conscious association or an internal thought.

`context` is recorded where note text is **prepared for dispatch**, including the
agent's existing 12,000-character selection, retrospective review's per-note
2,000-character selection, maintenance pair review, and MCP memory tool responses.
It does not prove provider acceptance, retention, attention or cognition. Counts
are JavaScript UTF-16 code units of selected note text/concatenation, not provider
tokens or JSON escaping overhead. Each version hash identifies the full preserved
note; `includedChars` identifies its contributing prefix. Maintenance context records
`redacted: true` when the existing credential-redaction transport changes the pair
payload; in that case counts describe the selected source prefix before redaction,
not the final transformed bytes. This does not log those bytes or disable redaction.
Empty notes and
separator-only truncation do not falsely attribute text to the next note.

Relationships are observed changes to wiki-link assertions, not similarity
scores. Actual byte changes produce `created`, `modified`, or `removed`. Machine
`phunbot-inferred` markers retain `kind: inferred`; unmarked links are `explicit`.
An explicit stored assertion is still a claim, not verified truth. Hashes retain
assertion-version correspondence without logging labels or reasons. Removed
outgoing links are captured on deletion; incoming dangling links remain present
until their source notes actually change. Parsing uses existing wiki-link syntax,
not a new semantic Markdown model; code examples can therefore contain literal
link syntax too. Future analysis should inspect the preserved Markdown context.

## Version lineage and explicit operations

Every successful locked write records its actual prior content hash and the
exact existing-format Markdown revision filename. Prior versions are fsynced
before replacing a note. Reads never invent revision counters or parent edges.
`Memory.link` goes through the same write boundary, so maintenance link changes
also retain content lineage. A no-op does not manufacture a link mutation.

`Memory.supersede(id, successorId)` is a narrow explicit API: both notes must
exist and differ, the source's frontmatter is actually marked
`status: superseded` and `superseded_by: <successor>`, and its prior version is
preserved. It does **not** remove the old note from search or change ranking.
`Memory.delete(id)` preserves its last Markdown version before removing it.
Neither API is added as an agent tool or automatically called by maintenance.
No baseline merge or split operation exists; no merge/split event is manufactured
from redundancy/atomicity suggestions. If such operations are introduced later,
they must use the write boundary and explicitly retain their many-to-many lineage.

## Reliability, failure visibility and privacy

A private cross-process lock serializes appends. The writer validates new bytes
since its last validated offset, handles short writes, appends with `O_APPEND`,
and fsyncs before reporting successful capture. It does not reread the entire
history per event. Startup and explicit audit validate the whole journal. This
is proportional filesystem storage, not a distributed transaction system.

Malformed/interrupted records fail closed. Existing bytes are never silently
truncated, rewritten or repaired. Journal failures do not alter successful memory
operations or inject new instructions into model context. Instead, a fixed stderr
warning and **sticky operator status** are exposed; `/health.memoryTelemetry`
and `Memory.telemetryStatus()` report `ok:false` and
`needsReconciliation:true`. A private failure marker survives restarts when the
filesystem permits it. Later successful calls do not silently clear the warning.
On a completely unwritable filesystem, no software can guarantee persisting a
new warning: stderr/in-process status remain the fallback, and startup revalidates
the journal. Source health fields retain their existing meanings; consumers must
check the separate memory telemetry field as well.

No bodies, queries, prompts, user sentences, link rationales, embeddings or raw
exceptions are logged. Schema and per-operation field allowlists reject unknown
and nested payload fields. Hashes are not encryption: low-entropy content may be
guessable. Treat IDs, hashes and activity patterns as private metadata.

A process killed while holding `state/memory-telemetry.lock` can leave a lock.
It is deliberately **not automatically reaped**: competing stale-lock reapers
must not remove a new live owner's lock. Bounded acquisition fails visibly.
Stop/quiesce all writers, verify the owner is absent, preserve private evidence,
and remove only that stale lock before recovery. A normal clean restart needs
no special action and preserves all journal bytes.

## Bypasses, uncertainty and reconciliation

Direct editor/filesystem writes, external renames/deletes, restoring backups,
manual writes into the revisions directory, and crashes between note mutation
and event append can bypass capture. Memory files and a JSONL append are not one
atomic transaction. `writeLocked` is the low-level mutation boundary; future
callers must hold the existing per-note locks. Arbitrary external code that writes
files directly remains unobservable. Pure index cache writes are not note changes.

For lightweight reconciliation, stop/quiesce writers and run from a private
operator shell (not a model prompt):

```js
const { Memory } = await import('/path/to/checkout/src/memory.mjs');
const memory = new Memory('/private/runtime/root');
console.log(memory.reconcileTelemetry());
```

This validates the journal, compares last recorded mutation/reconciliation
versions with current note hashes, and appends a reconciliation snapshot with
`unchanged`, `untracked`, `changed`, or `missing` states. `expectedVersion` and
observed `version` remain distinct. A snapshot is not a claim about the time or
cause of an external edit, deletion, merge or split. For versions missing from
live Markdown, compare the existing revision filenames/content hashes and private
backups. External deletion without a preserved revision/backup cannot be undone
from metadata alone; telemetry intentionally does not duplicate full contents.
Reconciliation is an operator snapshot, not an automatic behavior-changing scan.

If capture failed, the first report returns differences without clearing the
sticky warning. After preserving evidence and reviewing the uncertainty, use
`memory.reconcileTelemetry({ acknowledgeGap: true })`. It writes the observed
snapshot durably **before** clearing the failure marker. For a malformed journal,
first stop writers and preserve the entire original. Any repair/truncation or new
epoch is an explicit operator-approved recovery, not normal append behavior;
retain damaged bytes and document the gap privately. Acknowledgement does not
claim that lost events have been recovered. Audit/reconciliation must not race
external writers.

## Verification and release boundary

Automated synthetic tests cover exact identity/hash lineage, create/retrieve/
revise/supersede/delete, relationship changes, provenance isolation, real
multiprocess appenders, clean restart persistence, malformed/partial records,
sticky failure visibility, privacy validation, memory failures and external drift.
Existing search/immediate-learning/retrospective tests remain behavior gates.

All existing production release gates remain in force. Passing development tests
is not authorization to deploy, modify production, or assert that a live process
loaded these bytes. No visualization or production change is included.

## Synthetic event example

The following is intentionally synthetic. The hashes are illustrative placeholders,
not hashes of any real note. Only fields appropriate to this operation are shown.

```json
{"schemaVersion":1,"eventId":"00000000-0000-4000-8000-000000000001","observedAt":"2026-01-01T00:00:00.000Z","operation":"revise","outcome":"observed","context":{"sessionId":"session-demo","goalId":"goal-demo","phase":"immediate"},"notes":[{"id":"synthetic-note","version":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}],"previousVersion":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","preservedRevision":"synthetic-note-1704067200000-00000000-0000-4000-8000-000000000002.md"}
```
