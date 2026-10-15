import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { containsCredential } from "./privacy.mjs";
import {
  privateDirectory,
  readPrivateText,
  createPrivateText,
} from "./private-files.mjs";

function requireAppendBoundary(text) {
  let fence = null;
  for (const line of text.split("\n")) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!match) continue;
    if (!fence) fence = { char: match[1][0], length: match[1].length };
    else if (
      match[1][0] === fence.char &&
      match[1].length >= fence.length &&
      !match[2].trim()
    )
      fence = null;
  }
  if (fence)
    throw Error(
      "Unclosed manual Markdown fence requires owner reconciliation before machine append",
    );
}
export class Memory {
  constructor(root) {
    this.root = fs.realpathSync(root);
    for (const name of [
      "memory",
      "state/memory-locks",
      "state/memory-revisions",
    ]) {
      const directory = privateDirectory(this.root, name, { create: true });
      directory.close();
    }
  }
  file(id) {
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(id)) throw Error("Invalid note id");
    const dir = this.root + "/memory";
    if (fs.lstatSync(dir).isSymbolicLink())
      throw Error("Memory root symlink is not authorized");
    const file = dir + "/" + id + ".md";
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
      throw Error("Memory symlink is not authorized");
    return file;
  }
  locked(ids, operation) {
    const directory = privateDirectory(this.root, "state/memory-locks"),
      acquired = [];
    try {
      for (const id of [...new Set(ids)].sort()) {
        this.file(id);
        const name = id + ".lock",
          lock = directory.path + "/" + name;
        let done = false;
        for (let attempt = 0; attempt < 40; attempt++) {
          try {
            fs.mkdirSync(lock, { mode: 0o700 });
            acquired.push(lock);
            const owner = privateDirectory(
              this.root,
              "state/memory-locks/" + name,
            );
            try {
              createPrivateText(
                owner,
                "owner.json",
                JSON.stringify({ pid: process.pid, at: Date.now() }),
              );
            } finally {
              owner.close();
            }
            done = true;
            break;
          } catch (error) {
            if (error.code !== "EEXIST") throw error;
            const owner = privateDirectory(
              this.root,
              "state/memory-locks/" + name,
            );
            try {
              let data;
              try {
                data = JSON.parse(readPrivateText(owner, "owner.json"));
              } catch (error) {
                if (error.code !== "ENOENT") throw error;
              }
              if (data) {
                try {
                  process.kill(data.pid, 0);
                } catch (error) {
                  if (error.code === "ESRCH") {
                    fs.rmSync(lock, { recursive: true });
                    continue;
                  }
                  throw error;
                }
              }
            } finally {
              owner.close();
            }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
          }
        }
        if (!done)
          throw Error("Memory note is busy; retry after current update");
      }
      return operation();
    } finally {
      for (const lock of acquired.reverse())
        fs.rmSync(lock, { recursive: true, force: true });
      directory.close();
    }
  }
  get(id) {
    this.file(id);
    const directory = privateDirectory(this.root, "memory");
    try {
      return readPrivateText(directory, id + ".md");
    } finally {
      directory.close();
    }
  }
  writeLocked(id, text) {
    if (containsCredential(text))
      throw Error("Potential secret or credential cannot be stored in memory");
    this.file(id);
    const directory = privateDirectory(this.root, "memory");
    let temp;
    try {
      let old;
      try {
        old = readPrivateText(directory, id + ".md");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (old === text) return { id, unchanged: true };
      if (old !== undefined) {
        const revisions = privateDirectory(this.root, "state/memory-revisions");
        try {
          createPrivateText(
            revisions,
            id + "-" + Date.now() + "-" + crypto.randomUUID() + ".md",
            old,
          );
        } finally {
          revisions.close();
        }
      }
      temp = id + ".tmp-" + crypto.randomUUID();
      createPrivateText(directory, temp, text);
      fs.renameSync(
        directory.path + "/" + temp,
        directory.path + "/" + id + ".md",
      );
      temp = null;
      fs.fsyncSync(directory.fd);
      return {
        id,
        sha256: crypto.createHash("sha256").update(text).digest("hex"),
      };
    } finally {
      if (temp) fs.rmSync(directory.path + "/" + temp, { force: true });
      directory.close();
    }
  }
  save(id, text) {
    return this.locked([id], () => this.writeLocked(id, text));
  }
  put(id, title, body, source) {
    if (
      !source ||
      !title ||
      !body ||
      [title, body, source].some((x) => typeof x !== "string")
    )
      throw Error("Provenance, title and body required");
    return this.locked([id], () => {
      const observationId = crypto
        .createHash("sha256")
        .update(JSON.stringify([title.trim(), body.trim(), source.trim()]))
        .digest("hex");
      const marker = "<!-- phunbot-observation:" + observationId + " -->";
      const recordedAt = new Date().toISOString();
      if (fs.existsSync(this.file(id))) {
        const prior = this.get(id);
        if (prior.includes(marker)) return { id, unchanged: true };
        requireAppendBoundary(prior);
        // Ordinary observation is append-only: the agent must not reconstruct
        // a human-edited note or silently replace unrelated sections/frontmatter.
        return this.writeLocked(
          id,
          prior +
            "\n\n## Additional observation (unreconciled)\n\n" +
            marker +
            "\n\n" +
            body.trim() +
            "\n\nSource: " +
            JSON.stringify(source) +
            "\nRecorded: " +
            recordedAt +
            "\n",
        );
      }
      return this.writeLocked(
        id,
        "---\nid: " +
          id +
          "\nsource: " +
          JSON.stringify(source) +
          "\nupdated: " +
          recordedAt +
          "\nstatus: observed\n---\n\n# " +
          title.replace(/\n/g, " ") +
          "\n\n" +
          marker +
          "\n\n" +
          body.trim() +
          "\n",
      );
    });
  }
  list() {
    const directory = privateDirectory(this.root, "memory");
    try {
      return fs
        .readdirSync(directory.path)
        .filter((name) => name.endsWith(".md"))
        .map((name) => ({
          id: name.slice(0, -3),
          text: readPrivateText(directory, name),
        }));
    } finally {
      directory.close();
    }
  }
  search(query) {
    if (typeof query !== "string") throw Error("Search query required");
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.list()
      .map((n) => ({
        ...n,
        score: words.reduce(
          (s, w) => s + (n.text.toLowerCase().includes(w) ? 1 : 0),
          0,
        ),
      }))
      .filter((n) => n.score)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }
  link(a, b, reason) {
    if (a === b || !reason || typeof reason !== "string")
      throw Error("Meaningful reason required");
    return this.locked([a, b], () => {
      requireAppendBoundary(this.get(a));
      requireAppendBoundary(this.get(b));
      for (const [from, to] of [
        [a, b],
        [b, a],
      ]) {
        let text = this.get(from);
        if (text.includes("[[" + to + "]]")) continue;
        if (!text.includes("\n## Inferred relationships\n"))
          text +=
            "\n## Inferred relationships\n\n<!-- phunbot-owned inferred links; manual sections above are unchanged -->\n";
        text +=
          "\n- [[" +
          to +
          "]] <!-- phunbot-inferred: " +
          reason.replace(/-->/g, "").replace(/\n/g, " ") +
          " -->\n";
        this.writeLocked(from, text);
      }
      return { linked: [a, b], reason };
    });
  }
}
