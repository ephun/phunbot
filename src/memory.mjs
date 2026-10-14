import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class Memory {
  constructor(root) {
    this.root = root;
    fs.mkdirSync(root + '/memory', { recursive: true });
    fs.mkdirSync(root + '/state/memory-locks', { recursive: true });
  }
  file(id) {
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(id)) throw Error('Invalid note id');
    const dir = this.root + '/memory';
    if (fs.lstatSync(dir).isSymbolicLink()) throw Error('Memory root symlink is not authorized');
    const file = dir + '/' + id + '.md';
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw Error('Memory symlink is not authorized');
    return file;
  }
  locked(ids, operation) {
    const acquired = [];
    try {
      for (const id of [...new Set(ids)].sort()) {
        this.file(id);
        const lock = this.root + '/state/memory-locks/' + id + '.lock';
        let done = false;
        for (let attempt = 0; attempt < 40; attempt++) {
          try {
            fs.mkdirSync(lock);
            fs.writeFileSync(lock + '/owner.json', JSON.stringify({ pid: process.pid, at: Date.now() }));
            acquired.push(lock); done = true; break;
          } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            try {
              const owner = JSON.parse(fs.readFileSync(lock + '/owner.json'));
              try { process.kill(owner.pid, 0); } catch (e) {
                if (e.code === 'ESRCH') { fs.rmSync(lock, { recursive: true }); continue; }
              }
            } catch { /* A writer may still be creating the owner record. */ }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
          }
        }
        if (!done) throw Error('Memory note is busy; retry after current update');
      }
      return operation();
    } finally {
      for (const lock of acquired.reverse()) fs.rmSync(lock, { recursive: true, force: true });
    }
  }
  get(id) { return fs.readFileSync(this.file(id), 'utf8'); }
  writeLocked(id, text) {
    if (/(?:\b(?:api[_-]?key|password|access[_-]?token)\s*[:=]\s*\S{12,}|\bsk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._-]{20,})/i.test(text)) {
      throw Error('Potential secret cannot be stored in memory');
    }
    const file = this.file(id);
    if (fs.existsSync(file)) {
      const old = fs.readFileSync(file, 'utf8');
      if (old === text) return { id, unchanged: true };
      fs.mkdirSync(this.root + '/state/memory-revisions', { recursive: true });
      fs.writeFileSync(this.root + '/state/memory-revisions/' + id + '-' + Date.now() + '-' + crypto.randomUUID() + '.md', old, { mode: 0o600 });
    }
    const temp = file + '.tmp-' + crypto.randomUUID();
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
    return { id, sha256: crypto.createHash('sha256').update(text).digest('hex') };
  }
  save(id, text) { return this.locked([id], () => this.writeLocked(id, text)); }
  put(id, title, body, source) {
    if (!source || !title || !body || [title, body, source].some(x => typeof x !== 'string')) throw Error('Provenance, title and body required');
    return this.locked([id], () => {
      let links = '';
      if (fs.existsSync(this.file(id))) {
        const prior = this.get(id), at = prior.indexOf('\n## See also\n');
        if (at >= 0) links = prior.slice(at);
      }
      return this.writeLocked(id, '---\nid: ' + id + '\nsource: ' + JSON.stringify(source) + '\nupdated: ' + new Date().toISOString() + '\nstatus: observed\n---\n\n# ' + title.replace(/\n/g, ' ') + '\n\n' + body.trim() + '\n' + links);
    });
  }
  list() {
    return fs.readdirSync(this.root + '/memory').filter(x => x.endsWith('.md')).map(x => ({ id: x.slice(0, -3), text: this.get(x.slice(0, -3)) }));
  }
  search(query) {
    if (typeof query !== 'string') throw Error('Search query required');
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.list().map(n => ({ ...n, score: words.reduce((s, w) => s + (n.text.toLowerCase().includes(w) ? 1 : 0), 0) }))
      .filter(n => n.score).sort((a, b) => b.score - a.score).slice(0, 5);
  }
  link(a, b, reason) {
    if (a === b || !reason || typeof reason !== 'string') throw Error('Meaningful reason required');
    return this.locked([a, b], () => {
      this.get(a); this.get(b);
      for (const [from, to] of [[a, b], [b, a]]) {
        let text = this.get(from);
        if (text.includes('[[' + to + ']]')) continue;
        if (!text.includes('\n## See also\n')) text += '\n## See also\n';
        text += '\n- [[' + to + ']] <!-- phunbot-inferred: ' + reason.replace(/-->/g, '').replace(/\n/g, ' ') + ' -->\n';
        this.writeLocked(from, text);
      }
      return { linked: [a, b], reason };
    });
  }
}
