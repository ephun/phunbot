import crypto from "node:crypto";
import {
  privateDirectory,
  readPrivateText,
  replacePrivateText,
} from "./private-files.mjs";
const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
export function cosine(a, b) {
  if (a.length !== b.length)
    throw Error("Embedding dimensions changed; rebuild required");
  let ab = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}
export class Index {
  constructor(root, memory, embed) {
    this.root = root;
    this.memory = memory;
    this.embed = embed;
    this.file = root + "/cache/embeddings.json";
    this.busy = null;
  }
  load() {
    const directory = privateDirectory(this.root, "cache", { create: true });
    try {
      try {
        return JSON.parse(readPrivateText(directory, "embeddings.json"));
      } catch (error) {
        if (error.code === "ENOENT" || error instanceof SyntaxError)
          return { version: 1, notes: {} };
        throw error;
      }
    } finally {
      directory.close();
    }
  }
  async rebuild() {
    if (this.busy) return this.busy;
    this.busy = this.update();
    try {
      return await this.busy;
    } finally {
      this.busy = null;
    }
  }
  async update() {
    const prior = this.load(),
      notes = this.memory.list();
    const changed = notes.filter(
      (n) => prior.notes[n.id]?.hash !== hash(n.text),
    );
    const vectors = changed.length
      ? await this.embed(changed.map((n) => n.text))
      : [];
    if (
      vectors.length !== changed.length ||
      vectors.some(
        (v) =>
          !Array.isArray(v) || !v.length || v.some((x) => !Number.isFinite(x)),
      )
    )
      throw Error("Invalid embedding response");
    const out = { version: 1, notes: {} };
    for (const n of notes) {
      const i = changed.findIndex((x) => x.id === n.id);
      out.notes[n.id] =
        i >= 0 ? { hash: hash(n.text), vector: vectors[i] } : prior.notes[n.id];
    }
    const directory = privateDirectory(this.root, "cache", { create: true });
    try {
      replacePrivateText(
        directory,
        "embeddings.json",
        JSON.stringify(out, null, 2),
      );
    } finally {
      directory.close();
    }
    return { notes: notes.length, updated: changed.length };
  }
  async search(query) {
    await this.rebuild();
    const [q] = await this.embed([query]);
    if (!q?.length) throw Error("Invalid query embedding");
    const index = this.load();
    const exact = this.memory.search(query);
    const scored = [];
    for (const n of this.memory.list()) {
      const entry = index.notes[n.id];
      if (!entry || !Array.isArray(entry.vector) || entry.vector.length === 0) continue;
      const score = cosine(q, entry.vector) +
          (exact.find((x) => x.id === n.id) ? 0.2 : 0);
      scored.push({ ...n, score });
    }
    // Add semantic links: candidate reference targets from [[wikilinks]] in top scores.
    for (const n of [...scored].slice(0, 2)) {
      const refs = new Set();
      for (const match of n.text.matchAll(/\[\[([a-z0-9-]+)(?:\|[^\]]+)?\]\]/g)) {
        refs.add(match[1]);
      }
      // Only add reference links from scores that aren't already scored above.
      for (const refId of refs) {
        if (scored.some(s => s.id === refId) || new Set(scored.map(s => s.id)).has(refId)) continue;
        try {
          const text = this.memory.get(refId);
          if (text != null) scored.push({ id: refId, text, score: 0, relationshipFrom: n.id });
        } catch {}
        if (scored.length >= 7) break;
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const ids = new Set(scored.map((n) => n.id));
    for (const n of [...scored].slice(0, 2))
      for (const match of n.text.matchAll(
        /\[\[([a-z0-9-]+)(?:\|[^\]]+)?\]\]/g,
      )) {
        if (ids.has(match[1])) continue;
        try {
          scored.push({
            id: match[1],
            text: this.memory.get(match[1]),
            score: 0,
            relationshipFrom: n.id,
          });
          ids.add(match[1]);
        } catch {}
        if (scored.length >= 7) break;
      }
    this.memory.recordRetrieval("semantic", scored);
    return scored;
  }
  candidates() {
    const d = this.load(),
      ids = Object.keys(d.notes),
      pairs = [];
    for (let i = 0; i < ids.length; i++) {
      const vi = d.notes[ids[i]];
      if (!vi || !Array.isArray(vi.vector) || vi.vector.length === 0) continue;
      for (let j = i + 1; j < ids.length; j++) {
        const vj = d.notes[ids[j]];
        if (!vj || !Array.isArray(vj.vector) || vj.vector.length === 0) continue;
        pairs.push({
          a: ids[i],
          b: ids[j],
          score: cosine(d.notes[ids[i]].vector, d.notes[ids[j]].vector),
        });
      }
    }
    return pairs.sort((a, b) => b.score - a.score).slice(0, 10);
  }
}
export async function embedWithRuntime(runtime, provider, modelId, texts) {
  const resolved = runtime.getModel(provider, modelId) ||
    runtime.getModel(provider, "fleet-fast");
  if (!resolved) throw Error("Embedding provider unavailable");
  const result = await runtime.getAuth(resolved);
  if (!result?.auth?.apiKey)
    throw Error("Embedding provider authorization unavailable");
  const base = new URL(resolved.baseUrl);
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  const response = await fetch(new URL("embeddings", base), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + result.auth.apiKey,
      ...result.auth.headers,
    },
    body: JSON.stringify({ model: modelId, input: texts }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok)
    throw Error("Embedding endpoint returned " + response.status);
  const body = await response.json();
  if (!Array.isArray(body.data))
    throw Error("Embedding endpoint response invalid");
  return body.data.sort((a, b) => a.index - b.index).map((x) => x.embedding);
}
