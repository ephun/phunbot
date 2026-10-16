# Runtime configuration

The application reads runtime credentials from `config/secrets/nextcloud.json` and the configured CA/certificate bundle from `config/nextcloud-ca.pem`. These files are deliberately not published. Start from [`config/nextcloud.example.json`](../config/nextcloud.example.json), then place the populated JSON at the runtime secret path.

## Nextcloud

`baseUrl` is required and must be an HTTPS URL without embedded credentials, query, or fragment. Its hostname is used for the default HTTP `Host` header and TLS SNI/hostname validation; the source tree does not contain a deployment hostname.

The calendar path can be selected in either of two ways:

- Set `calendarPath` to an absolute path (without query or fragment), or
- Set `calendarName`; the adapter derives `/remote.php/dav/calendars/<encoded username>/<encoded calendar name>/`. If omitted, `calendarName` defaults to `phunbot-goals` for compatibility.

For an HTTPS endpoint reached by IP, set optional `serverName` to the certificate's DNS name. This changes TLS SNI and the name checked in the certificate, but does not disable CA-chain validation. The configured CA/certificate bundle remains required; an optional `certificateFingerprint256` adds a leaf SHA-256 pin. A CA bundle is not treated as an implicit leaf pin, because a normal chain contains a different leaf certificate. Never use a pin to bypass hostname or chain validation.

The adapter does not follow redirects and rejects cross-origin request paths, so Basic credentials cannot be sent to another origin. Errors intentionally omit response bodies and credential-bearing URLs.

## Model responsibilities

`roles.executor` selects normal execution; `roles.reviewer` selects independent deep verification and, by default, deep planning. An explicit `roles.planner` may select the configured deep planner separately. Planning and verification are separate operations even when they use the same model. The controller applies structured planning decisions and enforces lifecycle/lease/revision gates. See [goal lifecycle](goal-lifecycle.md).

## AMP uploads

`amp_upload_file` accepts local files only below roots listed in `AMP_MCP_UPLOAD_ROOTS`, as a comma-separated absolute-path list. There is no source-tree or machine-specific fallback: when the variable is unset or empty, the allowlist is empty and uploads fail closed. The launcher may set this variable for a specific runtime staging directory.

## Runtime layout and deployment example

`PHUNBOT_ROOT` selects private runtime storage (default `/data`); provider settings use the configured Pi agent directory, independently of the application checkout. `HOST` and `PORT` select the listening interface. Keep the web bearer in `config/secrets/web-token`, integration settings in `config/secrets/`, owner signing material private, and sessions/state/memory outside the source checkout. Example values are placeholders, not an alternate deployment implementation.

The Compose example takes `PHUNBOT_SOURCE_DIR` (the exact reviewed checkout's `src` directory) and `PHUNBOT_RUNTIME_DIR` from runtime environment. It does not choose host paths or public ingress. Its loopback binding is a safe example default; choose an authorized reachable binding for a real installation. Mount source read-only after dependency installation and AMP build. Do not run the example against production without deployment authorization. A mount without repository metadata cannot report an exact Git revision; see source-verification.md for independent checkout evidence requirements.

## n8n

The read-only workflow-listing tool reads `config/secrets/n8n.json` with `baseUrl` and `apiKey`. The URL must be credential-free HTTPS, or HTTP on explicit loopback for controlled tests, with no query or fragment. Redirects are rejected, including same-origin redirects, so a custom API-key header cannot be forwarded to a redirect target. Default Node TLS chain/hostname verification remains enabled; never set `NODE_TLS_REJECT_UNAUTHORIZED=0`. Do not put API keys in the URL.

The inactive candidate workflow example is separate from those tool credentials. Configure its candidate URL and exact reviewed Git/source/adapter identities and bind a candidate-only bearer locally before authorized isolated import/testing. It is not a production workflow export or proof of an executed awakening. See [source verification](source-verification.md).
