import { test } from "node:test";
import assert from "node:assert/strict";
import { controlledPlanner } from "./controlled-planner.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { start } from "../app.mjs";
class Tasks {
  data = new Map();
  counter = 0;
  async get(id) {
    if (!this.data.has(id)) throw Error("Nextcloud 404");
    return structuredClone(this.data.get(id));
  }
  async list() {
    return [...this.data.values()].map((x) => structuredClone(x));
  }
  async put(data, etag) {
    const old = this.data.get(data.id);
    if (old && etag !== old.etag) throw Error("Nextcloud 412");
    const next = structuredClone({ ...data, etag: String(++this.counter) });
    this.data.set(data.id, next);
    return next;
  }
}
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("Expected state not reached");
}
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-queue-api-"));
  fs.mkdirSync(root + "/config");
  fs.writeFileSync(
    root + "/config/policy.json",
    JSON.stringify({
      roles: { executor: "fixture" },
      limits: {
        maxActiveGoals: 1,
        turns: 2,
        sliceMs: 20,
        retryBackoffMs: 20,
        maxBackoffMs: 40,
      },
    }),
  );
  const nc = new Tasks();
  const calls = [];
  let resolve;
  const sessionFactory = async (row, { controller: c }) => {
    const act = async () => {
      calls.push(row.goalId);
      const cp = c.checkpoint(row.goalId);
      c.record(
        row.goalId,
        "controlled_progress",
        { slice: cp.slices },
        { step: cp.slices },
      );
      if (cp.slices < 5) {
        await new Promise((r) => {
          resolve = r;
        });
        return;
      }
      c.record(
        row.goalId,
        "assistant_output",
        {},
        {
          source:
            "Actual Pi assistant output; not independent proof of external state",
          text: "Recursion solves smaller versions of a problem until reaching a base case.",
          final: true,
        },
      );
    };
    return {
      busy: false,
      session: {
        prompt: act,
        sendCustomMessage: async (_message, options) => {
          if (options.triggerTurn) await act();
        },
        abort: async () => resolve?.(),
        dispose() {
          resolve?.();
        },
      },
    };
  };
  const server = await start({
    root,
    ncClient: nc,
    planner: controlledPlanner,
    answerVerifier: async () => ({pass:true,reason:"Controlled answer review fixture"}),
    sessionFactory,
    port: 0,
    token: "fixture",
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const api = async (url, body) => {
    const r = await fetch(base + "/api/" + url, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer fixture",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  return { root, nc, server, api, calls };
}

test("actual HTTP admission keeps two messages in one open parent and executes more than three normal slices", async () => {
  const f = await fixture();
  try {
    const { data: row } = await f.api("sessions", {});
    const first = await f.api("sessions/" + row.id + "/send", {
      requestId: "one",
      text: "What is recursion?",
    });
    const second = await f.api("sessions/" + row.id + "/send", {
      requestId: "two",
      text: "What is recursion?",
    });
    const duplicate = await f.api("sessions/" + row.id + "/send", {
      requestId: "two",
      text: "What is recursion?",
    });
    assert.equal(first.status, 202);
    assert.equal(second.status, 202);
    assert.equal(first.data.goalId, second.data.goalId);
    assert.equal(duplicate.data.goalId, second.data.goalId);
    await until(
      async () => (await f.nc.get(first.data.goalId)).status === "COMPLETED",
    );
    const cp = JSON.parse(
      fs.readFileSync(
        f.root + "/state/executions/" + first.data.goalId + ".json",
      ),
    );
    assert.ok(cp.slices >= 5);
    assert.equal(cp.retries || 0, 0);
  } finally {
    await new Promise((r) => f.server.close(r));
  }
});

test("admission during an overlapping empty recovery scan is not left waiting for another wakeup", async () => {
  const f = await fixture();
  let release, observed;
  const gate = new Promise((r) => (release = r)),
    ready = new Promise((r) => (observed = r));
  const list = f.nc.list.bind(f.nc);
  let first = true;
  f.nc.list = async () => {
    const snapshot = await list();
    if (first) {
      first = false;
      observed();
      await gate;
    }
    return snapshot;
  };
  try {
    const recovery = f.server.resumeGoals();
    await ready;
    const { data: row } = await f.api("sessions", {});
    const accepted = await f.api("sessions/" + row.id + "/send", {
      requestId: "overlapping",
      text: "What is recursion?",
    });
    assert.equal(accepted.status, 202);
    release();
    await recovery;
    await until(async () => f.calls.includes(accepted.data.goalId));
  } finally {
    release();
    await new Promise((r) => f.server.close(r));
  }
});

test("retired authorization controls cannot decide even an exact conversation goal and still reject foreign targets", async () => {
  const f = await fixture();
  try {
    const { data: row } = await f.api("sessions", {});
    await f.nc.put({
      id: "older-blocked",
      kind: "goal",
      conversationId: row.id,
      status: "NEEDS-ACTION",
      authorizations: [
        { id: "pending-one", state: "pending", hash: "fixture" },
      ],
    });
    const reply = await f.api("sessions/" + row.id + "/authorizations", {
      goalId: "older-blocked",
      requestId: "pending-one",
      approve: false,
    });
    assert.equal(reply.status, 409);
    assert.equal(
      (await f.nc.get("older-blocked")).authorizations[0].state,
      "pending",
    );
    const {data: other}=await f.api("sessions",{});
    const foreign=await f.api("sessions/"+other.id+"/authorizations",{
      goalId:"older-blocked",requestId:"pending-one",approve:true
    });
    assert.equal(foreign.status,400);
    assert.match(foreign.data.error,/Wrong conversation/);
  } finally {
    await new Promise((r) => f.server.close(r));
  }
});

test("missing request identity is explicitly not accepted", async () => {
  const f = await fixture();
  try {
    const { data: row } = await f.api("sessions", {});
    const r = await f.api("sessions/" + row.id + "/send", { text: "Hello" });
    assert.equal(r.status, 400);
    assert.equal(r.data.accepted, false);
  } finally {
    await new Promise((r) => f.server.close(r));
  }
});
