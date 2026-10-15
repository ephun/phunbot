import fs from "node:fs";
import crypto from "node:crypto";
import {
  privateDirectory,
  readPrivateText,
  replacePrivateText,
} from "./private-files.mjs";
function readCache(root, name) {
  const directory = privateDirectory(root, "cache", { create: true });
  try {
    return JSON.parse(readPrivateText(directory, name));
  } finally {
    directory.close();
  }
}
function writeState(root, relative, name, value) {
  const directory = privateDirectory(root, relative, { create: true });
  try {
    replacePrivateText(directory, name, JSON.stringify(value, null, 2));
  } finally {
    directory.close();
  }
}

async function maintainImpl(
  root,
  memory,
  index,
  review,
  { broad = false, maxPairs = 2 } = {},
) {
  const rebuilt = await index.rebuild();
  let previous = { pairs: {} };
  try {
    previous = readCache(root, "memory-review.json");
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError))
      throw error; /* Corrupt cache is replaceable, boundary violations are not. */
  }
  const snapshot = index.load();
  const report = {
    ok: true,
    notes: memory.list().length,
    embeddings: rebuilt,
    checks: [],
    relationships: [],
    contradictions: [],
    suggestions: [],
    evaluated: 0,
  };
  const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
  for (const note of memory.list()) {
    report.checks.push({
      id: note.id,
      readable: true,
      sha256: hash(note.text),
    });
    if (note.text.length > 2400 || note.text.split(/\n\s*\n/).length > 8) {
      report.suggestions.push({
        id: note.id,
        action: "review_atomicity",
        reason:
          "Consider splitting independently meaningful concepts. No automatic split or merge was performed.",
      });
    }
  }
  for (const pair of index.candidates()) {
    const key = pair.a + ":" + pair.b;
    const version =
      snapshot.notes[pair.a].hash + ":" + snapshot.notes[pair.b].hash;
    if (!broad && previous.pairs[key] === version) continue;
    if (report.evaluated >= maxPairs) break;
    const [a,b] = memory.withContext({phase:"maintenance"}, () => [memory.get(pair.a),memory.get(pair.b)]);
    const result = await review({
      a: { id: pair.a, text: a },
      b: { id: pair.b, text: b },
      similarity: pair.score,
    });
    if (
      typeof result.related !== "boolean" ||
      typeof result.contradiction !== "boolean" ||
      typeof result.reason !== "string" ||
      !result.reason.trim()
    ) {
      throw Error(
        "Memory relationship review returned invalid structured data",
      );
    }
    report.evaluated++;
    if (result.contradiction) {
      report.contradictions.push({
        a: pair.a,
        b: pair.b,
        reason: result.reason,
        status: "potential_conflict_requires_review",
      });
    } else if (result.related) {
      memory.withContext({phase:"maintenance"}, () => memory.link(pair.a, pair.b, result.reason.slice(0, 600)));
      if (
        !memory.get(pair.a).includes("[[" + pair.b + "]]") ||
        !memory.get(pair.b).includes("[[" + pair.a + "]]")
      )
        throw Error("Reciprocal link readback failed");
      report.relationships.push({
        a: pair.a,
        b: pair.b,
        reason: result.reason,
      });
    }
    if (result.redundant === true)
      report.suggestions.push({
        a: pair.a,
        b: pair.b,
        action: "review_redundancy",
        reason: result.reason,
        automaticMerge: false,
      });
    previous.pairs[key] = version;
  }
  writeState(root, "cache", "memory-review.json", previous);
  writeState(root, "state", "last-memory-review.json", {
    ...report,
    at: new Date().toISOString(),
  });
  return report;
}

export async function maintain(root, memory, index, review, options = {}) {
  return memory.withContext({phase:"maintenance"}, () => maintainImpl(root,memory,index,review,options));
}
