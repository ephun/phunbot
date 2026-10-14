import fs from 'node:fs';import {blockerKinds} from './tool-schemas.mjs';
import path from 'node:path';
import crypto from 'node:crypto';

const secretKey = /pass(word)?|token|secret|authorization|api[-_]?key|cookie|credential/i;
export function redact(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '[REDACTED]').replace(/(token|secret|password|api[_-]?key)\s*[:=]\s*[^,\s}]+/gi, '$1=[REDACTED]');
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, secretKey.test(k) && !(k === 'pass' && typeof v === 'boolean') ? '[REDACTED]' : redact(v)]));
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function json(value, limit = 10000) { return JSON.stringify(redact(value)).slice(0, limit); }
function explicitInitialTextAcknowledgement(value) {
  if (typeof value !== 'string') return false;
  return /\b(?:initial|first)\b/i.test(value) && /\btext[- ]only\b/i.test(value) && /\b(?:acknowledg\w*|early[_ -]?stop)\b/i.test(value);
}
function nativeInitialTextObservation(event) {
  if (event.tool !== 'assistant_output' || event.error !== false) return false;
  try {
    const result = JSON.parse(event.result);
    return result?.source === 'Actual Pi assistant output; not independent proof of external state' && typeof result.text === 'string' && result.emittedWithToolCalls === false && result.priorToolResults === 0;
  } catch { return false; }
}

export function atomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${crypto.randomUUID()}`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.renameSync(temp, file);
}

export class Controller {
  constructor(root, nc, limits = {}) { this.root = root; this.nc = nc; this.limits = { turns: 80, ms: 14400000, ...limits }; this.queues = new Map(); }
  checkpoint(id) {
    const f = `${this.root}/state/executions/${id}.json`;
    if (!fs.existsSync(f)) return { id, started: Date.now(), turns: 0, evidence: [], failures: {} };
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch (error) {
      const corrupt = `${f}.corrupt-${Date.now()}`;
      try { fs.copyFileSync(f, corrupt); } catch {}
      const backup = `${f}.bak`;
      if (fs.existsSync(backup)) {
        try { return JSON.parse(fs.readFileSync(backup, 'utf8')); } catch {}
      }
      throw new Error(`Execution state corrupt for ${id}`, { cause: error });
    }
  }
  save(c) { atomic(`${this.root}/state/executions/${c.id}.json`, c); }
  async lock(id, fn) { const prior = this.queues.get(id) || Promise.resolve(); const job = prior.catch(() => {}).then(fn); this.queues.set(id, job); try { return await job; } finally { if (this.queues.get(id) === job) this.queues.delete(id); } }
  async create(request, sessionFile, model) { const id = crypto.randomUUID(); const goal = await this.nc.put({ id, kind: 'goal', title: request.slice(0, 150), request, status: 'NEEDS-ACTION', created: new Date().toISOString() }); this.save({ ...this.checkpoint(id), sessionFile, model }); return goal; }
  validateCriteria(criteria) {
    if (!Array.isArray(criteria) || !criteria.length || criteria.length > 20) throw Error('Expected 1..20 criteria');
    return criteria.map(t => {
      if (!t || Object.keys(t).some(k => !['title', 'verifier'].includes(k)) || !t.title || !t.verifier || Object.keys(t.verifier).some(k => !['kind', 'path', 'text'].includes(k)) || !['file_contains', 'evidence_review'].includes(t.verifier.kind)) throw Error('Measurable verifier required');
      if (t.verifier.kind === 'file_contains' && (typeof t.verifier.path !== 'string' || typeof t.verifier.text !== 'string' || !t.verifier.text)) throw Error('Measurable verifier required');
      return { title: t.title, verifier: { ...t.verifier } };
    });
  }
  async plan(id, criteria, signal, review) { return this.lock(id, async () => { signal?.throwIfAborted();
    const g = await this.nc.get(id, signal); if (g.invalid || ['COMPLETED', 'CANCELLED'].includes(g.status)) throw Error('Goal is terminal');
    const clean = this.validateCriteria(criteria); if(review){const verdict=await review(g,clean);if(verdict?.pass!==true||typeof verdict.reason!=='string'||!verdict.reason.trim())throw Error('Independent plan coverage rejected: '+(verdict?.reason||'missing verdict'));g.planReview={...verdict,reviewedAt:new Date().toISOString()};} const planId = crypto.createHash('sha256').update(JSON.stringify(canonical(clean))).digest('hex').slice(0, 24);
    const expected = clean.map((_, i) => crypto.createHash('sha256').update(`${id}:${planId}:${i}`).digest('hex').slice(0, 32));
    if (g.planReady) { if (g.planId !== planId || JSON.stringify(g.expectedChildIds) !== JSON.stringify(expected)) throw Error('Plan already exists'); }
    else { await this.nc.put({ ...g, planId, expectedChildIds: expected, planReady: true }, g.etag, signal); }
    const result = []; for (let i = 0; i < clean.length; i++) { signal?.throwIfAborted(); const existing = (await this.nc.list(signal)).find(t => t.id === expected[i]); result.push(existing || await this.nc.put({ ...clean[i], id: expected[i], kind: 'criterion', parent: id, status: 'NEEDS-ACTION' }, undefined, signal)); }
    return result;
  }); }
  safeFile(relative) { const base = path.resolve(`${this.root}/work`), p = path.resolve(base, relative), real = fs.realpathSync(p); if (!p.startsWith(`${base}/`) || !real.startsWith(`${base}/`)) throw Error('Unauthorized verifier path'); return real; }
  async verify(id, taskId, review, signal) { return this.lock(id, async () => { signal?.throwIfAborted();
    const g = await this.nc.get(id, signal); if (g.invalid || ['CANCELLED', 'COMPLETED'].includes(g.status)) throw Error('Goal is terminal');
    const t = await this.nc.get(taskId, signal); if (t.invalid || t.parent !== id) throw Error('Wrong goal'); const v = t.verifier; let evidence;
    if (v.kind === 'file_contains') { const data = fs.readFileSync(this.safeFile(v.path), 'utf8'); if (!v.text || !data.includes(v.text)) throw Error('Criterion not satisfied'); evidence = { kind: v.kind, path: v.path, sha256: crypto.createHash('sha256').update(data).digest('hex') }; }
    else if (v.kind === 'evidence_review') { const all = this.checkpoint(id).evidence; const initialCriterion = explicitInitialTextAcknowledgement(t.title) && explicitInitialTextAcknowledgement(g.request); const actual = all.filter(e => !['goal_plan', 'goal_state', 'goal_verify', 'goal_unblock', 'assistant_output'].includes(e.tool) && (e.tool !== 'goal_blocker' || e.error === true)); const initial = initialCriterion ? all.filter(nativeInitialTextObservation) : []; const events = initialCriterion ? initial : actual; if (!events.length || !review) throw Error('Independent reviewer and actual tool evidence required'); const r = await review(t, events, g); if (r.pass !== true || !r.reason || !r.evidenceIds?.length || r.evidenceIds.some(x => !events.some(e => e.id === x)) || (initialCriterion && !r.evidenceIds.some(x => initial.some(e => e.id === x)))) throw Error('Independent review did not substantiate criterion'); evidence = { kind: v.kind, ...r }; }
    else throw Error('Verifier not implemented');
    signal?.throwIfAborted(); const updated = await this.nc.put({ ...t, status: 'COMPLETED', evidence: { ...evidence, verifiedAt: new Date().toISOString() } }, t.etag, signal); if (updated.status !== 'COMPLETED' || !updated.evidence) throw Error('Verification readback failed'); return updated;
  }); }
  deny(id,tool,args,reason){if(id)this.record(id,tool,args,{policy:'execution_guard',reason},true);return {block:true,reason};}
  failureKey(tool,args,id) { let revision=null;if(tool==='goal_verify'&&id){const facts=this.checkpoint(id).evidence.filter(e=>(!['goal_plan','goal_state','goal_verify','goal_unblock','assistant_output'].includes(e.tool))&& (e.tool!=='goal_blocker'||e.error===true)).map(e=>{try{return JSON.parse(e.result).policy==='execution_guard'?JSON.stringify([e.tool,e.args,e.result]):e.id;}catch{return e.id;}});revision=[...new Set(facts)].sort();}return crypto.createHash('sha256').update(JSON.stringify(canonical(revision===null?[tool,redact(args)]:[tool,redact(args),revision]))).digest('hex'); }
  record(id, tool, args, result, error = false, dispatchedKey) { const cp = this.checkpoint(id); const safeArgs = redact(args), safeResult = redact(result); const fingerprint = dispatchedKey||this.failureKey(tool,args,id); if (error) cp.failures[fingerprint] = (cp.failures[fingerprint] || 0) + 1; const e = { id: crypto.randomUUID(), at: new Date().toISOString(), tool, args: json(safeArgs), result: json(safeResult), error }; cp.evidence.push(e); cp.evidence = cp.evidence.slice(-100); this.save(cp); return e; }
  async unblock(id,review){return this.lock(id,async()=>{const g=await this.nc.get(id);if(g.status!=='NEEDS-ACTION'||g.blocker?.kind!=='dependency')throw Error('Only a recoverable dependency blocker can be cleared autonomously');const events=this.checkpoint(id).evidence.filter(e=>!g.blocker.evidenceIds.includes(e.id)&&Date.parse(e.at)>=Date.parse(g.blocker.at)&&!e.error&&!['goal_plan','goal_state','goal_verify','goal_blocker','goal_unblock','assistant_output'].includes(e.tool));if(!events.length||!review)throw Error('New actual recovery evidence required');const verdict=await review(g,events);if(verdict?.pass!==true||!verdict.reason)throw Error('Recovery is not substantiated');const next={...g,lastRecovery:{review:verdict,evidenceIds:events.map(e=>e.id),at:new Date().toISOString()}};delete next.blocker;return this.nc.put(next,g.etag);});}
  async cancel(id) { return this.lock(id, async () => { const g = await this.nc.get(id); if (g.status === 'CANCELLED') return g; if (g.status === 'COMPLETED') throw Error('Goal is terminal'); return this.nc.put({ ...g, status: 'CANCELLED' }, g.etag); }); }
  async blocker(id,p,review){return this.lock(id,async()=>{
    const g=await this.nc.get(id);if(['COMPLETED','CANCELLED'].includes(g.status))throw Error('Goal is terminal');
    const allEvidence=this.checkpoint(id).evidence;
    const events=allEvidence.filter(e=>p.evidenceIds?.includes(e.id)&&!['goal_plan','goal_state','goal_verify','goal_blocker','goal_unblock','assistant_output'].includes(e.tool));
    const unknownIds=p.evidenceIds?.filter(eid=>!allEvidence.some(e=>e.id===eid));
    const ownerPolicy=p.kind==='authorization'&&events.some(e=>{try{const value=JSON.parse(e.result);return value.policy==='owner_authorization'&&g.authorizations?.some(a=>a.id===value.requestId&&a.tool===e.tool&&['pending','denied'].includes(a.state));}catch{return false;}});
    const denial=/403|401|permission|authorization|safety|not authorized/i;
    const safety=p.kind==='safety';
    const commonBlockerValid=blockerKinds.includes(p.kind)&&typeof p.reason==='string'&&p.reason.trim()&&Array.isArray(p.alternatives)&&p.alternatives.length>0;
    const distinctActualEvents=events.length>=(ownerPolicy?1:2)&&new Set(events.map(e=>JSON.stringify([e.tool,e.args]))).size>=(ownerPolicy?1:2);
    if(safety&&unknownIds?.length)throw Error('Denial evidence reference not found: '+unknownIds.join(', '));
    if(!commonBlockerValid||(!safety&&!distinctActualEvents)||(safety&&(events.length<2||new Set(events.map(e=>JSON.stringify([e.tool,e.args]))).size<2)))throw Error(`Unsubstantiated blocker: real evidence from distinct alternatives is required; use UUIDs from goal_state().evidence, not memory note IDs or tool-call IDs. Current evidence: ${allEvidence.slice(-10).map(e=>`${e.id} (${e.tool})`).join(', ')}`);
    if(safety){
      const selfAuthored=/^(?:write|write_file|edit|edit_file|append|append_file|log|logger)/i;
      const anchors=events.filter(e=>e.error&&!selfAuthored.test(e.tool)&&denial.test(e.result));
      if(anchors.length<2||new Set(anchors.map(e=>JSON.stringify([e.tool,e.args]))).size<2)throw Error('Unsubstantiated blocker: two distinct actual denial anchors are required');
      const supplemental=events.filter(e=>!(e.error&&!selfAuthored.test(e.tool)&&denial.test(e.result)));
      if(supplemental.length&&!review)throw Error('Independent blocker review required for supplemental safety evidence');
    }
    if(['authorization'].includes(p.kind)&&!ownerPolicy&&(!events.every(e=>e.error)||!events.every(e=>denial.test(e.result))))throw Error('Unsubstantiated authorization boundary');
    if((ownerPolicy||['information','dependency'].includes(p.kind)||(safety&&events.some(e=>{const selfAuthored=/^(?:write|write_file|edit|edit_file|append|append_file|log|logger)/i;return !(e.error&&!selfAuthored.test(e.tool)&&denial.test(e.result));})))&&!review)throw Error('Independent blocker review required');
    let verdict;if(review){verdict=await review(g,p,events);if(verdict?.pass!==true||!verdict.reason)throw Error('Independent reviewer rejected blocker: '+(verdict?.reason||'unsupported'));}
    return this.nc.put({...g,blocker:{...p,review:verdict,at:new Date().toISOString()},status:'NEEDS-ACTION'},g.etag);
  });}

  async settle(id) { return this.lock(id, async () => { const g = await this.nc.get(id), cp = this.checkpoint(id); if (g.status === 'CANCELLED') return { continue: false, reason: 'cancelled' }; if (g.blocker) return { continue: false, reason: 'blocked', blocker: g.blocker }; const tasks = await this.nc.list(); const expected = Array.isArray(g.expectedChildIds) ? g.expectedChildIds : []; const planned = tasks.filter(t => t.parent === id); const complete = g.planReady && expected.length > 0 && planned.length === expected.length && new Set(planned.map(t => t.id)).size === expected.length && expected.every(x => planned.some(t => t.id === x && t.status === 'COMPLETED' && t.evidence && t.evidence.verifiedAt)); if (complete) { if (g.status !== 'COMPLETED') { const confirmed = await this.nc.put({ ...g, status: 'COMPLETED' }, g.etag); if (confirmed.status !== 'COMPLETED') throw Error('Goal readback failed'); } return { continue: false, reason: 'verified_complete' }; } if (g.status === 'COMPLETED') return { continue: false, reason: 'invalid_completion' }; if (cp.paused || cp.retries >= (this.limits.maxRetries??3) || cp.modelTurns >= (this.limits.maxModelTurns??80) || cp.turns >= this.limits.turns || Date.now() - cp.started >= this.limits.ms) { cp.paused = 'resource_limit'; this.save(cp); return { continue: false, reason: 'resource_limit' }; } cp.turns++; this.save(cp); return { continue: true, reason: Object.values(cp.failures).some(n => n >= 2) ? 'reconsider_strategy' : 'unfinished', remaining: expected.map(x => planned.find(t => t.id === x)).filter(Boolean).filter(t => t.status !== 'COMPLETED'), instruction: expected.length ? 'Criteria remain incomplete. Execute meaningful work and independently verify each.' : 'Formulate criteria using goal_plan. Prose cannot complete a goal.' }; }); }
}
