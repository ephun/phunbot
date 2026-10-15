import {embedWithRuntime} from '../index.mjs';
test('embedding requests use the configured API model id, not decorated discovery display names', async () => {
  const original = globalThis.fetch;
  let sent;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] }), { status: 200 });
  };
  try {
    const runtime = { getModel: () => ({ id: 'fleet-embed', name: 'fleet-embed (incomplete metadata)', baseUrl: 'http://127.0.0.1:4000/v1' }), getAuth: async () => ({ auth: { apiKey: 'controlled-fixture' } }) };
    assert.deepEqual(await embedWithRuntime(runtime, 'fixture', 'fleet-embed', ['An authored note.']), [[1, 0]]);
    assert.equal(sent.model, 'fleet-embed');
  } finally { globalThis.fetch = original; }
});
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {Memory} from '../memory.mjs';import {Index} from '../index.mjs';
test('replaceable embedding index rebuilds from Markdown and retrieves semantically related notes without modifying source',async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'phunbot-index-'));const memory=new Memory(root);memory.put('a-note','Agent Runtime','Pi runs the agent.','test fixture');memory.put('b-note','Goal State','Nextcloud stores tasks.','test fixture');const embed=async texts=>texts.map(x=>/Nextcloud|tasks|goal/i.test(x)?[0,1]:[1,0]);const index=new Index(root,memory,embed);await index.rebuild();const first=memory.get('a-note');assert.equal((await index.search('goal completion'))[0].id,'b-note');fs.rmSync(root+'/cache/embeddings.json');await index.rebuild();assert.equal(memory.get('a-note'),first);assert.equal((await index.search('runtime'))[0].id,'a-note');});
