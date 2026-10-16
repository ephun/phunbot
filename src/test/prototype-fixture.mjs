// Explicit synthetic test fixture. Never reads production storage or credentials.
import { controlledPlanner } from "./controlled-planner.mjs";
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  SessionManager
} from '@earendil-works/pi-coding-agent';
import {
  start
} from '../app.mjs';
export const specimen = JSON.parse(fs.readFileSync(new URL('./fixtures/prototype-ui.json', import.meta.url)));
export const conversationId = name => crypto.createHash('sha256').update(name).digest('hex').slice(0, 32);
export class FixtureTasks {
  data = new Map();
  count = 0;
  async list() {
    return structuredClone([...this.data.values()]);
  }
  async get(id) {
    if (!this.data.has(id)) throw Error('Nextcloud 404');
    return structuredClone(this.data.get(id));
  }
  async put(value, etag) {
    const old = this.data.get(value.id);
    if (old && old.etag !== etag) throw Error('Nextcloud 412');
    const row = {
      ...structuredClone(value),
      etag: String(++this.count)
    };
    this.data.set(row.id, row);
    return structuredClone(row);
  }
}
export async function prototypeFixture() {
  const root = fs.mkdtempSync(os.tmpdir() + '/phunbot-ui-browser-');
  for (const name of ['work', 'state', 'state/executions', 'config']) fs.mkdirSync(root + '/' + name, {
    recursive: true
  });
  fs.writeFileSync(root + '/config/policy.json', JSON.stringify({
    provider: 'fixture',
    roles: {
      executor: 'fixture',
      reviewer: 'fixture-deep',
      vision: 'fixture'
    },
    limits: {
      maxActiveGoals: 2,
      sliceMs: 60000
    },
    maintenance: {}
  }));
  const nc = new FixtureTasks(),
    managers = new Map(),
    folderId = crypto.randomUUID();
  fs.writeFileSync(root + '/state/folders.json', JSON.stringify([{
    id: folderId,
    name: 'Unraid',
    parentId: null
  }]));
  const catalog = specimen.chats.map(c => {
    const manager = SessionManager.create(root + '/work', root + '/state/pi-sessions');
    managers.set(conversationId(c.id), manager);
    c.history.forEach((m, i) => manager.appendMessage({
      role: m.kind,
      content: m.kind === 'user' ? m.text : [{
        type: 'text',
        text: m.text
      }],
      timestamp: 1760000000000 + i,
      ...(m.kind === 'assistant' ? {
        api: 'test',
        provider: 'fixture',
        model: 'fixture',
        usage: {
          input: 0,
          output: 0,
          totalTokens: 0
        },
        stopReason: 'stop'
      } : {})
    }));
    return {
      id: conversationId(c.id),
      title: c.name,
      folder: c.folder,
      folderId: c.folder ? folderId : null,
      model: 'fixture',
      sessionFile: manager.getSessionFile(),
      execution: 'idle',
      readResponseId: !c.unread ? manager.getBranch().findLast(e => e.type === 'message' && e.message.role === 'assistant')?.id : null,
      created: '2026-01-01T00:00:00.000Z'
    };
  });
  fs.writeFileSync(root + '/state/conversations.json', JSON.stringify(catalog));
  for (const g of specimen.goals) {
    const goal = {
      id: g.id,
      kind: 'goal',
      title: g.title,
      request: g.title,
      status: g.status === 'completed' ? 'COMPLETED' : 'NEEDS-ACTION',
      conversationId: conversationId(g.chat),
      created: '2026-01-01T00:00:00.000Z',
      execution: {
        state: g.status === 'working' ? 'queued' : g.status === 'waiting' ? 'transient_failure' : 'idle',
        nextRunAt: g.status === 'waiting' ? Date.now() + 600000 : 0
      },
      ...(g.status === 'blocked' ? {
        blocker: {
          kind: g.block === 'approval' ? 'authorization' : 'information',
          reason: g.block === 'approval' ? 'Waiting for your approval' : 'Waiting for your answer'
        }
      } : {})
    };
    await nc.put(goal);
    const events = [];
    for (const [i, ch] of g.children.entries()) {
      const id = g.id + '-criterion-' + i;
      await nc.put({
        id,
        kind: 'criterion',
        parent: g.id,
        title: ch.title,
        status: ch.status === 'completed' ? 'COMPLETED' : 'NEEDS-ACTION',
        ...(ch.status === 'completed' ? {
          evidence: {
            verifiedAt: '2026-01-01T00:00:00.000Z'
          }
        } : {}),
        verifier: {
          kind: 'evidence_review'
        }
      });
      for (const [j, e] of ch.events.entries()) events.push({
        id: g.id + '-event-' + i + '-' + j,
        at: '2026-01-01T' + (e.time === 'Now' ? '09:41' : e.time) + ':00.000Z',
        tool: e.label,
        args: JSON.stringify({
          criterionId: id
        }),
        result: JSON.stringify({
          text: e.detail
        }),
        error: false
      });
    }
    fs.writeFileSync(root + '/state/executions/' + g.id + '.json', JSON.stringify({
      id: g.id,
      evidence: events,
      turns: 0,
      failures: {}
    }));
  }
  const releases = new Map();
  const server = await start({
    root,
    ncClient: nc,
    planner: controlledPlanner,
    answerVerifier: async () => ({pass:true,reason:"Controlled answer review fixture"}),
    token: 'fixture',
    port: 0,
    host: '127.0.0.1',
    sessionFactory: async row => {
      let manager = managers.get(row.id);
      if (!manager) {
        manager = SessionManager.create(root + '/work', root + '/state/pi-sessions');
        managers.set(row.id, manager);
      }
      return {
        busy: false,
        session: {
          sessionManager: manager,
          modelRuntime: {
            getAvailable: async () => [{
              id: 'fixture',
              input: ['text', 'image']
            }, {
              id: 'fixture-deep',
              input: ['text']
            }],
            getModel: (_provider, id) => ['fixture', 'fixture-deep'].includes(id) ? {
              id,
              input: id === 'fixture' ? ['text', 'image'] : ['text']
            } : null
          },
          setModel: async () => {},
          sendCustomMessage: async (_message, options) => {
            if (options?.triggerTurn) await new Promise(resolve => releases.set(row.id, resolve));
          },
          prompt: async (text, options = {}) => {
            manager.appendMessage({
              role: 'user',
              content: options.images?.length ? [{
                type: 'text',
                text
              }, ...options.images] : text,
              timestamp: Date.now()
            });
            await new Promise(resolve => releases.set(row.id, resolve));
          },
          abort: async () => releases.get(row.id)?.(),
          dispose() {
            releases.get(row.id)?.();
          }
        }
      };
    }
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const api = async (url, method = 'GET', body) => {
    const r = await fetch(base + '/api/' + url, {
      method,
      headers: {
        Authorization: 'Bearer fixture',
        'Content-Type': 'application/json'
      },
      ...(body === undefined ? {} : {
        body: JSON.stringify(body)
      })
    });
    const value = await r.json();
    if (!r.ok) throw Error(JSON.stringify(value));
    return value;
  };
  return {
    root,
    nc,
    server,
    base,
    api,
    managers,
    releases,
    async close() {
      // Fence every synthetic goal before releasing held model calls, so shutdown
      // cannot dispatch a queued sibling while asynchronous finally blocks settle.
      for (const goal of await nc.list())
        if (goal.kind === 'goal' && !['COMPLETED', 'CANCELLED'].includes(goal.status)) await nc.put({
          ...goal,
          status: 'CANCELLED',
          lease: null
        }, goal.etag);
      for (const done of releases.values()) done();
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((await api('sessions')).every(row => !row.busy)) break;
        await new Promise(r => setTimeout(r, 10));
      }
      await new Promise(r => server.close(r));
      fs.rmSync(root, {
        recursive: true,
        force: true
      });
    }
  };
}
