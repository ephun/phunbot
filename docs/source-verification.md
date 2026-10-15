# Source verification and release gates

This repository is the canonical application implementation. Develop, review, test and (only with authorization) deploy the same Git checkout. Do not maintain a sanitized public implementation alongside a private application fork. Private directories contain configuration and operational data, not alternate application modules. An older private workspace is not an accepted deployment source.

## Deterministic identity

```sh
node src/source-verify.mjs --compact
node src/source-verify.mjs /absolute/path/to/checkout/src
```

The optional path is a **source directory**, not a runtime/data root. Output is JSON with deterministic sorted, source-relative paths and SHA-256 values. The default is the CLI's own source directory, independent of the current directory. Invalid paths, symlinks and unknown arguments fail with a nonzero exit and a generic diagnostic.

- `gitRevision`: exact full repository HEAD, or `null` when Git is unavailable (including an export without `.git`). This is not inferred from an environment variable.
- `gitDirty`: changes relative to HEAD limited to the application source allowlist, including deleted tracked source and untracked source candidates. `null` means unavailable, **not clean**. Staged and unstaged differences are checked against HEAD.
- `gitApplicability`: `application-source-only` or `unavailable`. Documentation, private config and operational data do not affect this dirty flag. Git metadata is queried; no broad content/status scan of runtime directories is performed.
- `trackedSourcePaths` and `untrackedSourcePaths`: distinguish version-controlled source from unexpected source candidates. A release checkout must have no unexpected source candidates and `gitDirty: false`.
- `files` / `sha256`: sorted application manifest and hash of its compact JSON object. Includes top-level `.mjs`, `.js`, `.css`, `.html`, package manifests/lockfiles; direct test/browser/integration `.mjs` files; AMP TypeScript source (including tests), package manifests/lockfile and TypeScript build manifests.
- `ampSourceFiles` / `ampSourceSha256`: the AMP subset of the application source manifest.
- `ampRuntimeFiles` / `ampRuntimeSha256`: separate generated adapter `.js` manifest and hash, excluding compiled tests. Missing build gives `null`, not an accepted empty build. Building AMP does not change the application source hash.

Only the explicit source paths are opened. Runtime state, credentials, configuration, vaults, sessions, logs and dependency trees are not traversed or hashed. AMP `src/auth/*.ts` is version-controlled authentication implementation, not a credential directory. Symlinks in scanned paths and their ancestors are rejected; final file opens use `O_NOFOLLOW`. This is not an atomic filesystem snapshot against a hostile actor concurrently replacing directory entries. Quiesce writes and use an immutable/read-only release checkout when recording evidence.

## Launcher correspondence

The launcher executes `vendor/amp/dist/index.js` beside `mcp-launch.mjs`; it no longer executes a second implementation under a runtime cache. The manifest's `ampLaunchPath` names that entry and `ampLaunchCorrespondence: on-disk-only` means those current files were observed. A regression executes the actual copied launcher with different source/cache fixtures and proves the source build is chosen.

This does **not** prove the bytes loaded in an already-running AMP process, reproducibility across arbitrary toolchains, dependency integrity, remote deployment identity or a correspondence between old runtime-cache output and the reviewed build. Capture build/toolchain evidence separately and restart only through an authorized release procedure. No real AMP mutation is needed for fingerprinting.

## Startup versus current disk

`GET /health` preserves `startupAppSha256`, `startupSourceSha256` and `startupSourceFiles`. It adds startup/current Git identities, startup/current adapter hashes, `currentSourceSha256`, `sourceDrifted`, `sourceVerification` and the launch-path observation. Startup fields are the module-load snapshot; current fields are recomputed on each request. Source or built-adapter drift sets `ok: false`. Unsafe or unreadable current source sets `sourceVerification: unavailable`, `sourceDrifted: null`, `ok: false` without disclosing filesystem errors. HTTP 200 remains for API compatibility; monitoring must inspect these JSON fields rather than HTTP status alone.

Hashes describe bytes observed at startup/on disk, not an attestation of V8's module cache. No secret values or absolute runtime paths are returned. This endpoint is unauthenticated, as before; restrict network access and rate-limit it externally if needed because complete hashing is synchronous work.

## Review → test → deployment receipt

1. Use a clean checkout of the exact reviewed commit. Install dependencies with `npm ci` in `src` and `src/vendor/amp`; run AMP tests/build and application/integration/browser checks. Do not edit source during evidence capture.
2. Save the CLI JSON **outside the source tree** alongside commands, runtime/toolchain versions and test results. Re-run it and compare exact JSON and both source/adapter hashes. The source hash covers tests but not dependencies or external build tools.
3. After publication, independently fetch the PR head, check its exact SHA, build/test it and compare its manifest with the tested checkout. A file embedded in its own manifest cannot carry its final revision/hash without a self-reference; publish the final manifest as an external PR review receipt.
4. Only after authorization, use that same version-controlled source (not edited copies) for deployment. The example Compose file separates the reviewed source mount from private runtime storage; populate host paths at runtime. A source-only mount without accessible Git metadata reports Git as unavailable, not as a verified revision; provide separately verified checkout/deployment evidence rather than overriding it with an untrusted environment label.
5. Compare deployed startup **and** current source and adapter hashes, verify the revision via the accessible checkout, inspect drift, and reconcile actual service logs/readbacks. A local fixture does not establish production identity.
6. Preserve the prior source/build and protected runtime backup before deployment. Roll back through the authorized process, then verify the prior identity, service health and durable data preservation. Fingerprinting is read-only and is not a rollback mechanism.

## Candidate n8n template

`config/n8n-workflow.template.json` is inactive and contains no exported project ownership/version/runtime metadata. Before an authorized isolated import, populate its `Candidate configuration` node with the candidate base URL and the exact reviewed Git/source/built-adapter identities. Bind the credential name to a separately provisioned bearer and choose an isolated webhook path. The default placeholders deliberately fail closed. The guard requires matching startup/current identities, no source drift and clean applicable Git state before resume or memory review calls. The guard code has controlled regression tests; these are not actual n8n execution evidence. Do not activate, overwrite a production workflow, or add automatic infrastructure rollback without authorization.

## Unsatisfied release gates

- Independent review of the final published revision and resulting fixes.
- Explicitly authorized disposable AMP mutation, readback and rollback.
- Authorized candidate n8n awakening through an approved reachable path.
- Authorized production deployment and exact-source verification.
- Live rollback and durable-data preservation validation.

Automated/isolated passes do not satisfy these live gates. No deployment is automatic.
