# Runtime configuration

The application reads runtime credentials from `config/secrets/nextcloud.json` and the configured CA/certificate bundle from `config/nextcloud-ca.pem`. These files are deliberately not published. Start from [`config/nextcloud.example.json`](../config/nextcloud.example.json), then place the populated JSON at the runtime secret path.

## Nextcloud

`baseUrl` is required and must be an HTTPS URL without embedded credentials, query, or fragment. Its hostname is used for the default HTTP `Host` header and TLS SNI/hostname validation; the source tree does not contain a deployment hostname.

The calendar path can be selected in either of two ways:

- Set `calendarPath` to an absolute path (without query or fragment), or
- Set `calendarName`; the adapter derives `/remote.php/dav/calendars/<encoded username>/<encoded calendar name>/`. If omitted, `calendarName` defaults to `phunbot-goals` for compatibility.

For an HTTPS endpoint reached by IP, set optional `serverName` to the certificate's DNS name. This changes TLS SNI and the name checked in the certificate, but does not disable CA validation or certificate pinning. The configured CA/certificate file remains required, and an optional `certificateFingerprint256` can add an explicit SHA-256 pin. Never use a pin to bypass hostname validation.

The adapter does not follow redirects and rejects cross-origin request paths, so Basic credentials cannot be sent to another origin. Errors intentionally omit response bodies and credential-bearing URLs.

## AMP uploads

`amp_upload_file` accepts local files only below roots listed in `AMP_MCP_UPLOAD_ROOTS`, as a comma-separated absolute-path list. There is no source-tree or machine-specific fallback: when the variable is unset or empty, the allowlist is empty and uploads fail closed. The launcher may set this variable for a specific runtime staging directory.
