# phunbot

Sanitized development publication for architectural review.

> **Status:** development/review branch only. This is not release acceptance, deployment evidence, or a replacement for any private runtime configuration.

## Scope

This tree contains the application source and deterministic tests, package manifests and lockfiles, and the vendored AMP adapter source needed to inspect or build the launcher integration. It intentionally excludes deployment credentials, provider configuration, durable user data, memory, runtime sessions, logs, generated dependencies, generated AMP output, private operational reports, and private Git history.

The source snapshot was prepared from the revision workspace while preserving the current bytes of `src/app.mjs` and `src/index.mjs`. The public baseline was cloned at commit `1332d19314aa2efc68b1cab8d2e555a282b2de6c`; the review branch is `feat/architecture-revision`.

## Layout

- `src/` — application modules, browser assets, tests, and package manifests.
- `src/vendor/amp/src/` — complete TypeScript source for the AMP MCP adapter.
- `src/vendor/amp/package.json`, `package-lock.json`, `tsconfig.json`, `LICENSE` — AMP build/test metadata.
- `ARCHITECTURE_STATUS.md` — current design status and review concerns, not acceptance evidence.

## Development checks

From `src/`:

```sh
npm ci
npm test
npx playwright install chromium
node browser/acceptance.mjs
```

The server expects deployment-local values when used beyond isolated tests. Do not commit tokens, provider credentials, private endpoints, durable state, or host-specific paths. Use a local temporary data root and explicit environment variables for development.

For the vendored AMP adapter:

```sh
cd src/vendor/amp
npm ci
npm test
npm run build
```

`dist/` and `node_modules/` are generated locally and are not part of this publication.

## Review boundary

Passing deterministic tests demonstrates only the checked source seams. It does not establish production readiness, unattended operation, external-service availability, authorization correctness, deployment safety, or release acceptance. Reviewers should treat all network endpoints, authentication, persistence, and infrastructure integration as deployment-provided interfaces.

## License

The AMP adapter retains its upstream `LICENSE`. Application licensing and publication policy should be confirmed by the repository owner before merge or release.
