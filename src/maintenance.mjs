import fs from 'node:fs';
import crypto from 'node:crypto';
import { atomic } from './controller.mjs';

export async function maintain(root, memory, index, review, { broad = false, maxPairs = 2 } = {}) {
  const rebuilt = await index.rebuild();
  const stateFile = root + '/cache/memory-review.json';
  let previous = { pairs: {} };
  try { previous = JSON.parse(fs.readFileSync(stateFile)); } catch { /* Cache is replaceable. */ }
  const snapshot = index.load();
  const report = { ok: true, notes: memory.list().length, embeddings: rebuilt, checks: [], relationships: [], contradictions: [], suggestions: [], evaluated: 0 };
  const hash = text => crypto.createHash('sha256').update(text).digest('hex');
  for (const note of memory.list()) {
    report.checks.push({ id: note.id, readable: true, sha256: hash(note.text) });
    if (note.text.length > 2400 || note.text.split(/\n\s*\n/).length > 8) {
      report.suggestions.push({ id: note.id, action: 'review_atomicity', reason: 'Consider splitting independently meaningful concepts. No automatic split or merge was performed.' });
    }
  }
  for (const pair of index.candidates()) {
    const key = pair.a + ':' + pair.b;
    const version = snapshot.notes[pair.a].hash + ':' + snapshot.notes[pair.b].hash;
    if (!broad && previous.pairs[key] === version) continue;
    if (report.evaluated >= maxPairs) break;
    const a = memory.get(pair.a), b = memory.get(pair.b);
    const result = await review({ a: { id: pair.a, text: a }, b: { id: pair.b, text: b }, similarity: pair.score });
    if (typeof result.related !== 'boolean' || typeof result.contradiction !== 'boolean' || typeof result.reason !== 'string' || !result.reason.trim()) {
      throw Error('Memory relationship review returned invalid structured data');
    }
    report.evaluated++;
    if (result.contradiction) {
      report.contradictions.push({ a: pair.a, b: pair.b, reason: result.reason, status: 'potential_conflict_requires_review' });
    } else if (result.related) {
      memory.link(pair.a, pair.b, result.reason.slice(0, 600));
      if (!memory.get(pair.a).includes('[[' + pair.b + ']]') || !memory.get(pair.b).includes('[[' + pair.a + ']]')) throw Error('Reciprocal link readback failed');
      report.relationships.push({ a: pair.a, b: pair.b, reason: result.reason });
    }
    if (result.redundant === true) report.suggestions.push({ a: pair.a, b: pair.b, action: 'review_redundancy', reason: result.reason, automaticMerge: false });
    previous.pairs[key] = version;
  }
  atomic(stateFile, previous);
  atomic(root + '/state/last-memory-review.json', { ...report, at: new Date().toISOString() });
  return report;
}
