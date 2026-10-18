# Runtime configuration

The application reads runtime credentials from `config/secrets/nextcloud.json`. HTTPS uses Node's default trusted CA store. An optional private CA/certificate bundle at `config/nextcloud-ca.pem` augments that trust store; it does not replace public roots or disable certificate validation. These private files are deliberately not published. The supported deployment runtime is Node 22.19.0 or newer. Start from [`config/nextcloud.example.json`](../config/nextcloud.example.json), then place the populated JSON at the runtime secret path.

## Nextcloud

`baseUrl` is required and must be an HTTPS URL without embedded credentials, query, or fragment. Its hostname is used for the default HTTP `Host` header and TLS SNI/hostname validation; the source tree does not contain a deployment hostname.

The calendar path can be selected in either of two ways:

- Set `calendarPath` to an absolute path (without query or fragment), or
- Set `calendarName`; the adapter derives `/remote.php/dav/calendars/<encoded username>/<encoded calendar name>/`. If omitted, `calendarName` defaults to `phunbot-goals` for compatibility.

For an HTTPS endpoint reached by IP, set optional `serverName` to the certificate's DNS name. This changes TLS SNI and the name checked in the certificate, but does not disable CA-chain validation. The CA/certificate bundle is optional; when present it augments the default trust store. An optional `certificateFingerprint256` adds a leaf SHA-256 pin. A CA bundle is not treated as an implicit leaf pin, because a normal chain contains a different leaf certificate. Never use a pin to bypass hostname or chain validation.

The adapter does not follow redirects and rejects cross-origin request paths, so Basic credentials cannot be sent to another origin. Errors intentionally omit response bodies and credential-bearing URLs.

## Model responsibilities

`roles.planner`, `roles.executor`, and `roles.reviewer` default to `fleet-fast`. Planning and verification remain separate invocations with independently constructed contexts, even when they use identical weights. `roles.embedding` remains `fleet-embed`. Keep `roles.vision` only for a capability-verified image route; names alone do not prove vision support or weight identity. Coding does not automatically select `fleet-code`, and `fleet-deep` is not a default planner or fallback. The controller applies structured planning decisions and enforces lifecycle/lease/revision gates. See [goal lifecycle](goal-lifecycle.md).

`planning.identityNote` and `planning.procedureNote` name required Markdown notes, loaded deterministically before planning and supplied to execution. Missing configured notes suspend planning rather than allowing an identity/context-free plan. Seed `goal-planning-procedure` from [the reviewed procedure](planning-procedure.md) through the existing Memory API; authorized later revisions remain possible. Memory observations cannot override schemas, permissions, or lifecycle authority.

`planning.enableThinking: false` explicitly requests `chat_template_kwargs.enable_thinking=false` for Chat Completions planning and answer review on the verified supporting backend. Responses payloads never receive this chat-only field. This setting is opt-in and is not an assumption that every backend supports it. `planning.timeoutMs` bounds the complete two-attempt planning operation. Attempts retain sanitized metadata in execution checkpoints; semantic failures receive field-level repair feedback, whereas permanent HTTP rejections, programming exceptions, cancellation, and expired deadlines do not issue an unchanged second request.

Wire verifier variants match deterministic validation: `file_contains` has nonempty path/text; `answer_quality` and `evidence_review` have empty path/text. External/composite goals restrict answer-quality verification using the same outcome contract as the controller. Required subgoal `parentId` is nullable, not optional. Original requests remain immutable in `request`/`requestHistory`; planner descriptions are interpretations only.

`recovery.heldRevisions` is an optional deployment safety map of goal ID to highest held revision. It prevents automatic claims of pre-cutover work without changing authoritative goal status or erasing evidence. New substantive instructions create a higher revision and release only that goal. An operator may remove a hold after reconciliation; deployment must not silently replay historical tasks.

## AMP uploads

`amp_upload_file` accepts local files only below roots listed in `AMP_MCP_UPLOAD_ROOTS`, as a comma-separated absolute-path list. There is no source-tree or machine-specific fallback: when the variable is unset or empty, the allowlist is empty and uploads fail closed. The launcher may set this variable for a specific runtime staging directory.

## Runtime layout and deployment example

`PHUNBOT_ROOT` selects private runtime storage (default `/data`); provider settings use the configured Pi agent directory, independently of the application checkout. `HOST` and `PORT` select the listening interface. Keep the web bearer in `config/secrets/web-token`, integration settings in `config/secrets/`, owner signing material private, and sessions/state/memory outside the source checkout. Example values are placeholders, not an alternate deployment implementation.

The Compose example takes `PHUNBOT_SOURCE_DIR` (the exact reviewed checkout's `src` directory) and `PHUNBOT_RUNTIME_DIR` from runtime environment. It does not choose host paths or public ingress. Its loopback binding is a safe example default; choose an authorized reachable binding for a real installation. Mount source read-only after dependency installation and AMP build. Do not run the example against production without deployment authorization. A mount without repository metadata cannot report an exact Git revision; see source-verification.md for independent checkout evidence requirements.

## n8n

The read-only workflow-listing tool reads `config/secrets/n8n.json` with `baseUrl` and `apiKey`. The URL must be credential-free HTTPS, or HTTP on explicit loopback for controlled tests, with no query or fragment. Redirects are rejected, including same-origin redirects, so a custom API-key header cannot be forwarded to a redirect target. Default Node TLS chain/hostname verification remains enabled; never set `NODE_TLS_REJECT_UNAUTHORIZED=0`. Do not put API keys in the URL.

The inactive candidate workflow example is separate from those tool credentials. Configure its candidate URL and exact reviewed Git/source/adapter identities and bind a candidate-only bearer locally before authorized isolated import/testing. It is not a production workflow export or proof of an executed awakening. See [source verification](source-verification.md).
