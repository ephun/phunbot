import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

// Product source and the built AMP adapter only. Never traverse runtime storage,
// dependency trees, test artifacts, credentials, vaults, or session directories.
// This is a startup-source snapshot, not a claim about already cached OS/VM code.
export function sourceFingerprint(directory) {
  const files = {};
  const add = (relative) => {
    const target = path.join(directory, relative),
      stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw Error("Release source must be regular files");
    files[relative] = hash(fs.readFileSync(target));
  };
  for (const entry of fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    if (
      /\.(?:mjs|js|css|html)$/.test(entry.name) ||
      ["package.json", "package-lock.json"].includes(entry.name)
    )
      add(entry.name);
  }
  const compiled = path.join(directory, "vendor/amp/dist");
  if (fs.existsSync(compiled)) {
    const visit = (relative) => {
      if (fs.lstatSync(path.join(directory, relative)).isSymbolicLink())
        throw Error("Release adapter symlink is not authorized");
      for (const entry of fs
        .readdirSync(path.join(directory, relative), { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))) {
        const child = relative + "/" + entry.name;
        if (entry.isDirectory()) visit(child);
        else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js"))
          add(child);
      }
    };
    visit("vendor/amp/dist");
  }
  return { sha256: hash(JSON.stringify(files)), files };
}
