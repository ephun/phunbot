import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const manifestHash = (files) => sha256(JSON.stringify(files));

function sourceFile(name) {
  return /\.(?:mjs|js|css|html)$/.test(name) ||
    ["package.json", "package-lock.json"].includes(name);
}
function ampSourceFile(name) {
  return name.endsWith(".ts") && !name.endsWith(".test.ts") ||
    ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"].includes(name);
}
function ampRuntimeFile(name) {
  return name.endsWith(".js") && !name.endsWith(".test.js");
}

/** Verify directory is real, not a symlink target. */
function assertDirectory(directory, label = "Release source") {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink()) throw Error(`${label} symlink is not authorized`);
  if (!stat.isDirectory()) throw Error(`${label} directory is required`);
}

/** Walk a subdirectory tree, accepting files by predicate, rejecting symlinks. */
function collect(directory, relative, acceptFn, label) {
  const current = path.join(directory, relative);
  assertDirectory(current, label);
  const files = {};
  function visit(rel) {
    const dir = path.join(directory, rel);
    assertDirectory(dir, label); // lstat check on every directory entry
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      const targetPath = path.join(directory, child);
      // lstat on each non-root entry to detect symlinks (Dirent.isdir ignores them)
      if (!rel && entry.isFile()) continue; // handled above for root scan
      const ls = fs.lstatSync(targetPath);
      if (ls.isSymbolicLink()) throw Error(`${label} symlink is not authorized: ${child}`);
      if (ls.isDirectory()) visit(child);
      else if (entry.isFile() && acceptFn(entry.name, child)) {
        files[child] = sha256(fs.readFileSync(targetPath));
      }
    }
  }
  visit(relative);
  return files;
}

/** Git revision and dirty state scoped to tracked source only. */
function gitInfo(directory, files) {
  const run = (args, cwd) =>
    spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

  const top = run(["rev-parse", "--show-toplevel"], directory);
  if (top.status !== 0) return { gitRevision: null, gitDirty: null };
  const repo = top.stdout.trim();

  const revision = run(["rev-parse", "HEAD"], repo);
  if (revision.status !== 0) return { gitRevision: null, gitDirty: null };
  const revId = revision.stdout.trim();

  // Determine source paths under the project root (stripped of "vendor" prefix)
  const relativeDir = path.relative(repo, directory).split(path.sep).join("/");
  const knownRootFiles = new Set(Object.keys(files));

  const isSource = (name) => {
    const stripped = name.replace(/^src\//, "");
    if (!stripped || !stripped.includes("/")) {
      // bare filename like app.mjs
      return knownRootFiles.has(stripped);
    }
    // vendor/amp path check — use the stripped version so "src/vendor/amp/src/index.ts" matches
    return stripped.startsWith("vendor/amp/src/") || stripped.startsWith("vendor/amp/dist/");
  };

  // --untracked-files=no: only show changes to tracked files (avoids untracked noise)
  const statusOutput = run(
    ["status", "--porcelain=v1", "--untracked-files=no", "--", relativeDir ? "." : ""],
    repo
  );
  let dirty = false;
  if (statusOutput.status === 0 && statusOutput.stdout.trim()) {
    for (const line of statusOutput.stdout.split("\n")) {
      if (!line) continue;
      const item = line.slice(3); // remove "MM " / "M " prefix
      const names = item.includes(" -> ") ? item.split(" -> ") : [item];
      if (names.some((name) => isSource(name))) { dirty = true; break; }
    }
  }

  return { gitRevision: revId, gitDirty: dirty };
}

/**
 * Fingerprint application source only — never runtime/storage/config/auth/vault.
 *
 * Returns a deterministic snapshot:
 *   - sha256 / files       : all tracked source (app + AMP source + AMP built dist)
 *   - ampSourceSha256      : separate invariant for just the TypeScript sources
 *   - ampRuntimeSha256     : separate invariant for the compiled adapter
 *   - gitRevision / gitDirty: repo identity scoped to application source
 *   - ampLaunchCorrespondence: "not-evaluated" — set later when launcher path is known
 */
export function sourceFingerprint(directory) {
  const root = path.resolve(directory);
  assertDirectory(root);

  // Top-level project files (same as original behavior, but with symlink guard)
  const files = {};
  for (const entry of fs.readdirSync(root, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    if (!sourceFile(entry.name)) continue;
    const targetPath = path.join(root, entry.name);
    const ls = fs.lstatSync(targetPath);
    if (ls.isSymbolicLink() || !entry.isFile())
      throw Error(`Release source symlink is not authorized: ${entry.name}`);
    files[entry.name] = sha256(fs.readFileSync(targetPath));
  }

  // AMP vendor: reject symlinks at every level of vendor/amp so a sibling-directory symlink
  // (e.g. vendor/amp/fake-src → vendor/amp/src) is caught even if collect only scans src/.
  const vendorRoot = path.join(root, "vendor/amp");
  const hasVendorAmp = fs.existsSync(vendorRoot);
  if (hasVendorAmp) {
    for (const entry of fs.readdirSync(vendorRoot, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const lp = path.join(vendorRoot, entry.name);
      if (entry.isSymbolicLink())
        throw Error(`Release source symlink is not authorized: vendor/amp/${entry.name}`);
    }
  }

  // AMP TypeScript sources (separate fingerprint)
  const ampSourceFiles = hasVendorAmp && fs.existsSync(path.join(root, "vendor/amp/src"))
    ? collect(root, "vendor/amp/src", ampSourceFile, "AMP source") : {};

  // AMP built adapter (separate fingerprint; this is what launcher actually runs)
  const ampRuntimeFiles = hasVendorAmp && fs.existsSync(path.join(root, "vendor/amp/dist"))
    ? collect(root, "vendor/amp/dist", ampRuntimeFile, "AMP runtime adapter") : {};

  // Combined manifest hash
  const all = { ...files, ...ampSourceFiles, ...ampRuntimeFiles };

  return {
    sha256: manifestHash(all),
    files,
    ampSourceSha256: manifestHash(ampSourceFiles),
    ampSourceFiles,
    ampRuntimeSha256: manifestHash(ampRuntimeFiles),
    ampRuntimeFiles,
    ampLaunchCorrespondence: "not-evaluated",
    ...gitInfo(root, all),
  };
}

/** Compare a startup snapshot against current disk to detect drift. */
export function sourceDrift(startup, directory) {
  const current = sourceFingerprint(directory);
  return { current, drifted: current.sha256 !== startup.sha256 };
}
