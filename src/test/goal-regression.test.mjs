import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Controller} from '../controller.mjs';
import {outcomeContract} from '../outcomes.mjs';
import {planGoal} from '../planning.mjs';
import {compactHistory, goalReadModels} from '../ui-read-models.mjs';

class Tasks {
  data = new Map(); counter = 0;
  async get(id) { return structuredClone(this.data.get(id)); }
  async list() { return structuredClone([...this.data.values()]); }
  async put(value, etag) {
    const old = this.data.get(value.id);
    if (old ? old.etag !== etag : Boolean(etag)) throw Error('412');
    const next = {...structuredClone(value), etag: String(++this.counter)};
    this.data.set(value.id, next); return structuredClone(next);
  }
}

test('every plain conversational request can receive a goal answer without phrase whitelisting', () => {
  for (const text of ['Hi. Tell me who you are.', 'Hello?', 'Test', 'Introduce yourself', 'Tell me a joke', 'Can you explain recursion?']) {
    assert.equal(outcomeContract(text).kind, 'answer', text);
  }
});

test('a planner cannot impersonate owner completion or bypass criteria', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phunbot-completion-'));
  try {
    const nc = new Tasks(), c = new Controller(root, nc);
    const goal = await c.create('Hi. Tell me who you are.', 'session', 'fast');
    const before = await nc.get(goal.id);
    await assert.rejects(() => c.applyPlanning(goal.id, {execution:'complete'}, before.revision || 1), /owner action/i);
    assert.deepEqual(await nc.get(goal.id), before);
    await c.complete(goal.id);
    assert.equal((await nc.get(goal.id)).completionKind, 'user-directed');
  } finally { fs.rmSync(root, {recursive:true, force:true}); }
});

test('planner cannot request owner completion through its schema or result', async () => {
  const runtime = {
    getModel: () => ({id:'deep'}),
    completeSimple: async (_model, _payload, options) => {
      const payload = options.onPayload({});
      assert.ok(!payload.response_format.json_schema.schema.properties.execution.enum.includes('complete'));
      return {content:[{type:'text', text:JSON.stringify({title:'Greeting',description:'Answer the introduction',criteria:[],subgoals:[],changes:[],execution:'complete'})}]};
    }
  };
  await assert.rejects(() => planGoal(runtime, {provider:'fixture',roles:{reviewer:'deep'}}, {request:'Hi. Tell me who you are.'}, [], [], []), e=>e.name==='PlanningDecisionError'&&e.diagnostics.issues.some(x=>x.path==='execution'&&x.code==='enum'));
});

test('failed pre-execution attempts remain visible without fabricated tools or reasoning', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phunbot-attempt-'));
  try {
    const nc = new Tasks(), c = new Controller(root, nc);
    const goal = await c.create('Hi. Tell me who you are.', 'session', 'fast');
    const cp = c.checkpoint(goal.id);
    cp.attempts = [{id:'attempt-1',started:1000,ended:2000,outcome:'transient_failure'}];
    cp.lastError = 'Planning rejected'; c.save(cp);
    const history = compactHistory(root, goal.id);
    assert.equal(history.count, 1);
    assert.equal(history.items[0].tool, 'execution_attempt');
    assert.equal(history.items[0].error, true);
    assert.match(history.items[0].summary, /transient_failure/);
    const [view] = goalReadModels({goals:[goal],catalog:[],root});
    assert.equal(view.liveExecution.error, 'Planning rejected');
    assert.deepEqual(c.checkpoint(goal.id).evidence, []);
  } finally {fs.rmSync(root, {recursive:true,force:true});}
});
