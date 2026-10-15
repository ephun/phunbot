# phunbot

Version-controlled application source for development, independent review, testing and authorized deployment.

> **Status:** review candidate, not release acceptance. No production deployment is authorized by this repository or by passing its automated checks.

## One implementation

Use this repository's exact Git revision for all application stages. Runtime configuration, credentials, canonical sessions, state, Markdown memory and service data live outside the checkout. Do not maintain a separate private application implementation or perform deployment-specific source substitutions. Old development workspaces are historical, not release sources.

## Layout

- `src/`: application modules, browser assets, tests and locked dependency manifests.
- `src/vendor/amp/src/`: vendored AMP TypeScript source and tests.
- `config/`: sanitized examples and an **inactive** candidate n8n workflow template, not production configuration.
- [Runtime configuration](docs/configuration.md).
- [Source identity, evidence and release procedure](docs/source-verification.md).
- `ARCHITECTURE_STATUS.md`: review status, limitations and outstanding gates.

## Development checks

Use the supported Node runtime in `config/compose.yaml` or a compatible newer runtime. From the repository root:

```sh
npm ci --prefix src
npm ci --prefix src/vendor/amp
npm test --prefix src/vendor/amp
npm run build --prefix src/vendor/amp
npm test --prefix src
node src/integration/native-faults.mjs
cd src
npx playwright install chromium
node browser/acceptance.mjs
```

`node_modules/` and AMP `dist/` are generated, not published application source. Keep the build output immutable and record its separate fingerprint. Tests use controlled fixtures unless specifically documented otherwise. Native Pi tests exercise the installed native runtime with a local provider and Tasks fixture, not live production integrations.

Record source identity from any working directory:

```sh
node /path/to/checkout/src/source-verify.mjs --compact
```

Store the final manifest and test receipts outside the source tree. Publication and production identity must be verified separately; local test results are not proof of untested live behavior.

## Release safety

Do not activate the workflow example or start a production replacement automatically. Final published-revision review, approved disposable AMP mutation/readback/rollback, candidate n8n awakening, production deployment/exact-source verification and live rollback remain explicit authorization gates.

## License

The AMP adapter retains its upstream `LICENSE`. Application licensing and publication policy should be confirmed by the repository owner before merge or release.

## Observational memory telemetry

See [native memory telemetry](docs/memory-telemetry.md) for the private runtime
journal schema, captured boundaries, lineage, limitations and operator reconciliation.
Telemetry does not change memory retrieval or maintenance decisions.
