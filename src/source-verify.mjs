#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { sourceFingerprint } from "./source-fingerprint.mjs";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: node src/source-verify.mjs [source-directory] [--compact]");
} else {
  const paths = args.filter((arg) => !arg.startsWith("--"));
  if (paths.length > 1 || args.some((arg) => arg.startsWith("--") && arg !== "--compact")) {
    console.error("Invalid arguments. Use --help for usage.");
    process.exitCode = 1;
  } else {
    try {
      const manifest = sourceFingerprint(paths[0] ?? fileURLToPath(new URL(".", import.meta.url)));
      console.log(JSON.stringify(manifest, null, args.includes("--compact") ? 0 : 2));
    } catch {
      // Do not disclose filesystem paths or error payloads from a failed scan.
      console.error("Source verification failed: missing, unreadable or unsafe source path.");
      process.exitCode = 1;
    }
  }
}
