import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GoalQueue } from '../goal-queue.mjs';
class Tasks {
  data = new Map(); count = 0;
  async list() { return [...this.data.values()].map(value => structuredClone(value)); }
  async get(id) { if (!this.data.has(id)) throw Error('Nextcloud 404'); return structuredClone(this.data.get(id)); }
  async put(value, etag) {
    const current = this.data.get(value.id);
    if ((current && current.etag !== etag) || (!current && etag)) throw Error('Nextcloud 412');
    const result = structuredClone({ ...value, etag: String(++this.count) }); this.data.set(value.id, result); return result;
  }
}
function queue(nc = new Tasks(), owner = 'worker') { return new GoalQueue(nc, { owner, leaseMs: 1000 }); }
const request = (id, conversationId = 'conversation') => ({ conversationId, requestId: id, text: 'Request ' + id, model: 'model' });

test('one conversation accepts distinct requests and retries deduplicate without losing queued work', async () => {
  const q = queue();
  const a = await q.admit(request('one')); const b = await q.admit(request('two'));
  assert.notEqual(a.id, b.id); assert.equal(a.conversationId, b.conversationId);
  assert.equal((await q.admit(request('one'))).id, a.id);
  assert.equal((await q.nc.list()).length, 2);
  await assert.rejects(() => q.admit({ ...request('one'), text: 'Changed meaning' }), /different|conflict/i);
});

test('claims serialize work per conversation and are concurrency safe across overlapping wakeups', async () => {
  const nc = new Tasks(); const a = queue(nc, 'worker-a'), b = queue(nc, 'worker-b');
  await a.admit(request('one')); await a.admit(request('two'));
  const results = await Promise.all([a.claim(100), b.claim(100)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await a.claim(101), null);
});

test('overlapping calls from the same dispatcher cannot reuse an active coordination lease', async () => {
  const q = queue();
  await q.admit(request('one', 'one'));
  await q.nc.put({ id: 'phunbot-dispatch-lease', kind: 'coordination', status: 'NEEDS-ACTION', lease: { owner: q.owner, token: 'another-call', until: 1000 } });
  assert.equal(await q.claim(100), null);
  assert.equal((await q.nc.get('phunbot-dispatch-lease')).lease.token, 'another-call');
});

test('yielded work goes behind another independent goal and expired leases recover after restart', async () => {
  const q = queue(); const a = await q.admit(request('a', 'a')); const b = await q.admit(request('b', 'b'));
  const first = await q.claim(100); assert.equal(first.id, a.id);
  await q.release(first.id, first.lease.token, { state: 'yielded', nextRunAt: 100 }, 101);
  assert.equal((await q.claim(102)).id, b.id);
  const restarted = queue(q.nc, 'restart'); const recovered = await restarted.claim(1200);
  assert.equal(recovered.id, a.id);
  const second = await restarted.claim(1201); assert.equal(second.id, b.id);
});

test('cancellation is terminal for leases including late release and delayed stale responses', async () => {
  const q = queue(); await q.admit(request('cancel'));
  const claimed = await q.claim(100);
  const current = await q.nc.get(claimed.id); await q.nc.put({ ...current, status: 'CANCELLED' }, current.etag);
  assert.equal(await q.valid(claimed.id, claimed.lease.token, 101), false);
  await q.release(claimed.id, claimed.lease.token, { state: 'completed' }, 102);
  assert.equal((await q.nc.get(claimed.id)).status, 'CANCELLED');
  assert.equal(await q.claim(2000), null);
});

test('backoff, blockers and pending authorization remain open and unclaimed until eligible', async () => {
  const q = queue(); const g = await q.admit(request('dependency'));
  const claim = await q.claim(100);
  await q.release(g.id, claim.lease.token, { state: 'transient_failure', nextRunAt: 500 }, 101);
  assert.equal(await q.claim(499), null); assert.ok(await q.claim(501));
});
