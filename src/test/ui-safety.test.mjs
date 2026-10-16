import {
  test
} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  prototypeFixture,
  conversationId
} from './prototype-fixture.mjs';
import {
  FolderStore
} from '../ui-folders.mjs';
import {
  compactHistory
} from '../ui-read-models.mjs';

test('search reads canonical visible history without initializing a model or exposing thinking', async () => {
  const f = await prototypeFixture();
  try {
    const manager = f.managers.get(conversationId('minecraft'));
    manager.appendMessage({
      role: 'assistant',
      content: [{
        type: 'thinking',
        thinking: 'secret-canary-thought'
      }, {
        type: 'text',
        text: 'visible-canary-answer'
      }],
      timestamp: Date.now(),
      api: 'test',
      provider: 'fixture',
      model: 'fixture',
      usage: {
        input: 0,
        output: 0,
        totalTokens: 0
      },
      stopReason: 'stop'
    });
    assert.equal((await f.api('search?q=visible-canary-answer'))[0].id, conversationId('minecraft'));
    assert.deepEqual(await f.api('search?q=secret-canary-thought'), []);
    assert.ok((await f.api('search?q=protocol')).some(x => x.kind === 'chat' && x.id === conversationId('mcp')));
    assert.equal((await fetch(f.base + '/api/search?q=protocol')).status, 401);
    assert.equal((await fetch(f.base + '/api/search?q=' + 'a'.repeat(201), {
      headers: {
        Authorization: 'Bearer fixture'
      }
    })).status, 400);
  } finally {
    await f.close();
  }
});
test('folder names and membership survive rename and a fresh store without browser authority', async () => {
  const f = await prototypeFixture();
  try {
    const folder = await f.api('folders', 'POST', {
      name: 'Research'
    });
    await f.api('sessions/' + conversationId('mcp'), 'PATCH', {
      folderId: folder.id
    });
    await f.api('folders/' + folder.id, 'PATCH', {
      name: 'Studies'
    });
    const row = (await f.api('sessions')).find(r => r.id === conversationId('mcp'));
    assert.equal(row.folder, 'Studies');
    assert.equal(row.folderId, folder.id);
    assert.equal(new FolderStore(f.root).get(folder.id).name, 'Studies');
    await f.api('sessions/' + row.id, 'PATCH', {
      folderId: null
    });
    await f.api('folders/' + folder.id, 'DELETE');
    assert.equal(new FolderStore(f.root).get(folder.id), null);
    fs.writeFileSync(f.root + '/state/folders.json', 'broken');
    assert.throws(() => new FolderStore(f.root));
  } finally {
    await f.close();
  }
});
test('read receipts persist only an exact visible response identity and ignore thinking-only turns', async () => {
  const f = await prototypeFixture();
  try {
    const id = conversationId('backups'),
      route = 'sessions/' + id;
    assert.equal((await f.api('sessions')).find(r => r.id === id).unread, true);
    const messages = await f.api(route + '/messages');
    await f.api(route + '/read', 'POST', {
      responseId: messages.lastResponseId
    });
    assert.equal((await f.api('sessions')).find(r => r.id === id).unread, false);
    const manager = f.managers.get(id);
    manager.appendMessage({
      role: 'assistant',
      content: [{
        type: 'thinking',
        thinking: 'Hidden-only turn'
      }],
      timestamp: Date.now(),
      api: 'test',
      provider: 'fixture',
      model: 'fixture',
      usage: {
        input: 0,
        output: 0,
        totalTokens: 0
      },
      stopReason: 'stop'
    });
    assert.equal((await f.api('sessions')).find(r => r.id === id).unread, false);
    manager.appendMessage({
      role: 'assistant',
      content: [{
        type: 'text',
        text: 'A new controlled response'
      }],
      timestamp: Date.now(),
      api: 'test',
      provider: 'fixture',
      model: 'fixture',
      usage: {
        input: 0,
        output: 0,
        totalTokens: 0
      },
      stopReason: 'stop'
    });
    const rejected = await fetch(f.base + '/api/' + route + '/read', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer fixture',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        responseId: messages.lastResponseId
      })
    });
    assert.equal(rejected.status, 409);
    assert.equal((await f.api('sessions')).find(r => r.id === id).unread, true);
    const stored = JSON.parse(fs.readFileSync(f.root + '/state/conversations.json')).find(r => r.id === id);
    assert.equal(stored.readResponseId, messages.lastResponseId);
    assert.ok(!JSON.stringify(stored).includes('A new controlled response'));
  } finally {
    await f.close();
  }
});
test('one live goal never marks another goal in the same conversation as executing', async () => {
  const f = await prototypeFixture();
  try {
    await f.server.resumeGoals();
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if ((await f.api('ui/goals')).find(g => g.id === 'mph').liveExecution.state === 'running') {
        ready = true;
        break;
      }
      await new Promise(r => setTimeout(r, 10));
    }
    assert.equal(ready, true);
    await f.nc.put({
      id: 'sibling',
      kind: 'goal',
      title: 'Persisted stale running label',
      conversationId: conversationId('mph'),
      status: 'NEEDS-ACTION',
      execution: {
        state: 'running'
      },
      created: '2026-01-01T00:00:00.000Z'
    });
    const goals = await f.api('ui/goals');
    assert.equal(goals.find(g => g.id === 'mph').liveExecution.state, 'running');
    assert.equal(goals.find(g => g.id === 'sibling').liveExecution.state, 'idle');
    assert.equal(goals.find(g => g.id === 'sibling').persistentStatus, 'NEEDS-ACTION');
  } finally {
    await f.close();
  }
});
test('invalid folder assignment cannot partially mutate conversation metadata', async () => {
  const f = await prototypeFixture();
  try {
    const id = conversationId('mcp'),
      before = (await f.api('sessions')).find(r => r.id === id);
    const r = await fetch(f.base + '/api/sessions/' + id, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer fixture',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        folder: 'ghost',
        folderId: 'unknown',
        title: 'ghost'
      })
    });
    assert.equal(r.status, 400);
    const after = (await f.api('sessions')).find(r => r.id === id);
    assert.equal(after.folder, before.folder);
    assert.equal(after.title, before.title);
  } finally {
    await f.close();
  }
});
test('execution history is bounded, paginated, redacted and rejects path/parameter escapes', async () => {
  const f = await prototypeFixture();
  try {
    const evidence = Array.from({
      length: 205
    }, (_, i) => ({
      id: 'e' + i,
      tool: 'read',
      args: JSON.stringify({
        password: 'do-not-disclose'
      }),
      result: '{}'
    }));
    fs.writeFileSync(f.root + '/state/executions/minecraft.json', JSON.stringify({
      evidence
    }));
    const first = await f.api('ui/goals/minecraft/history?expand=1&limit=100');
    assert.equal(first.count, 205);
    assert.equal(first.items.length, 100);
    assert.equal(first.nextOffset, 100);
    assert.equal(first.hasMore, true);
    assert.equal(first.items[0].args.password, '[REDACTED]');
    const end = await f.api('ui/goals/minecraft/history?expand=1&limit=100&offset=200');
    assert.equal(end.items.length, 5);
    assert.equal(end.hasMore, false);
    assert.throws(() => compactHistory(f.root, '../../config/policy'));
    assert.throws(() => compactHistory(f.root, 'minecraft', {
      limit: NaN
    }));
    fs.writeFileSync(f.root + '/state/executions/minecraft.json', 'broken');
    assert.throws(() => compactHistory(f.root, 'minecraft'));
  } finally {
    await f.close();
  }
});
