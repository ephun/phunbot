import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const sorted = (files) => Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
const digest = (files) => hash(JSON.stringify(sorted(files)));
const manifests = ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"];
const topFile = (name) => /\.(?:mjs|js|css|html)$/.test(name) || manifests.slice(0, 2).includes(name);
const allowed = (name) => !name.includes("/") ? topFile(name) :
  /^(?:test|integration|browser)\/[^/]+\.mjs$/.test(name) ||
  /^vendor\/amp\/src\/(?!.*(?:^|\/)node_modules\/).*\.ts$/.test(name) ||
  manifests.some((m) => name === `vendor/amp/${m}`);

// Check every path component before accessing it. No realpath/following links.
function safeStat(target) {
  const absolute = path.resolve(target);
  const parts = absolute.slice(path.parse(absolute).root.length).split(path.sep);
  let current = path.parse(absolute).root, stat;
  for (const part of parts) {
    current = path.join(current, part);
    try { stat = fs.lstatSync(current); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
    if (stat.isSymbolicLink()) throw Error("Source symlink is not authorized");
  }
  return stat;
}
function readHash(target) {
  const stat = safeStat(target);
  if (!stat?.isFile()) throw Error("Source must be a regular file");
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { return hash(fs.readFileSync(fd)); }
  finally { fs.closeSync(fd); }
}
function walk(root, relative, accept, files, recursive = false) {
  const target = path.join(root, relative);
  const stat = safeStat(target);
  if (!stat) return;
  if (!stat.isDirectory()) throw Error("Source directory is required");
  for (const name of fs.readdirSync(target).sort()) {
    // Only inspect source candidates; never descend into runtime/dependency trees.
    const child = relative ? `${relative}/${name}` : name;
    if (["node_modules", "config", "vault", "runtime", "state", "cache", ".git"].includes(name)) continue;
    if (recursive) {
      const entry = safeStat(path.join(root, child));
      if (entry?.isDirectory()) { walk(root, child, accept, files, true); continue; }
    }
    if (accept(child)) files[child] = readHash(path.join(root, child));
  }
}
function gitInfo(root, files) {
  const run = (args) => spawnSync("git", ["--no-optional-locks", "-C", root, ...args], {
    encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 10000,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const absent = { gitRevision: null, gitDirty: null, gitApplicability: "unavailable", untrackedSourcePaths: [], trackedSourcePaths: [] };
  const revision = run(["rev-parse", "--verify", "HEAD"]);
  if (revision.status !== 0 || !/^[a-f0-9]{40,64}\n?$/.test(revision.stdout)) return absent;
  const prefix = run(["rev-parse", "--show-prefix"]);
  const tree = run(["ls-tree", "--full-name", "-r", "--name-only", "-z", "HEAD", "--", "."]);
  if (prefix.status !== 0 || tree.status !== 0) return { ...absent, gitRevision: revision.stdout.trim() };
  // ls-tree paths are repository-relative. Filter metadata before any content reads.
  const tracked = tree.stdout.split("\0").filter(Boolean)
    .map((name) => name.startsWith(prefix.stdout.trim()) ? name.slice(prefix.stdout.trim().length) : "")
    .filter(allowed).sort();
  const current = Object.keys(files);
  const untracked = current.filter((name) => !tracked.includes(name)).sort();
  const candidates = [...new Set([...tracked, ...current])].sort();
  // Exact literal source paths only: Git never stats/reads runtime configuration.
  const diff = candidates.length ? run(["--literal-pathspecs", "diff", "--quiet", "--no-ext-diff", "--no-textconv", "HEAD", "--", ...candidates]) : { status: 0 };
  return {
    gitRevision: revision.stdout.trim(),
    gitDirty: diff.status === 0 || diff.status === 1 ? diff.status === 1 || untracked.length > 0 : null,
    gitApplicability: "application-source-only",
    trackedSourcePaths: tracked, untrackedSourcePaths: untracked,
  };
}

/** Application source and built AMP bytes are intentionally separate identities. */
export function sourceFingerprint(directory) {
  const root = path.resolve(directory);
  if (!safeStat(root)?.isDirectory()) throw Error("Source directory is required");
  const source = {};
  walk(root, "", allowed, source);
  for (const dir of ["test", "browser", "integration"]) walk(root, dir, allowed, source);
  walk(root, "vendor/amp/src", allowed, source, true);
  for (const name of manifests) {
    const relative = `vendor/amp/${name}`;
    if (safeStat(path.join(root, relative))) source[relative] = readHash(path.join(root, relative));
  }
  const files = sorted(source);
  const ampSourceFiles = sorted(Object.fromEntries(Object.entries(files).filter(([name]) => name.startsWith("vendor/amp/"))));
  const built = {};
  walk(root, "vendor/amp/dist", (name) => name.endsWith(".js") && !name.endsWith(".test.js"), built, true);
  const ampRuntimeFiles = sorted(built);
  return {
    schemaVersion: 1, sha256: digest(files), files,
    ...gitInfo(root, files),
    ampSourceSha256: digest(ampSourceFiles), ampSourceFiles,
    ampRuntimeSha256: Object.keys(built).length ? digest(ampRuntimeFiles) : null, ampRuntimeFiles,
    ampLaunchPath: "vendor/amp/dist/index.js",
    ampLaunchCorrespondence: built["vendor/amp/dist/index.js"] ? "on-disk-only" : "missing",
  };
}

export function sourceDrift(startup, directory) {
  const current = sourceFingerprint(directory);
  return { current, drifted: current.sha256 !== startup.sha256 || current.ampRuntimeSha256 !== startup.ampRuntimeSha256 };
}
