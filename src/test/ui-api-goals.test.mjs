import {
  test
} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  start
} from "../app.mjs";

class FixtureNextcloud {
  constructor(rows = []) {
    this.rows = new Map(rows.map((x) => [x.id, structuredClone(x)]));
  }
  async list() {
    return [...this.rows.values()].map((x) => structuredClone(x));
  }
  async get(id) {
    if (!this.rows.has(id)) throw Error("Nextcloud 404");
    return structuredClone(this.rows.get(id));
  }
  async put(value) {
    this.rows.set(value.id, structuredClone(value));
    return structuredClone(value);
  }
}

test("authenticated UI goal read model separates authoritative status from live execution and criteria activities", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-ui-goals-"));
  const nc = new FixtureNextcloud([{
    id: "goal-1",
    kind: "goal",
    title: "Ship UI",
    request: "Ship the UI",
    status: "NEEDS-ACTION",
    conversationId: "conv-1",
    planReady: true,
    expectedChildIds: ["criterion-1"],
    execution: {
      state: "queued"
    }
  }, {
    id: "criterion-1",
    kind: "criterion",
    parent: "goal-1",
    title: "Tests pass",
    status: "COMPLETED",
    verifier: {
      kind: "file_contains"
    },
    evidence: {
      verifiedAt: "2026-01-01T00:00:00.000Z"
    }
  }, {
    id: "goal-2",
    kind: "goal",
    title: "Other",
    request: "Other",
    status: "COMPLETED",
    conversationId: "conv-2",
    execution: {
      state: "completed"
    }
  }, ]);
  fs.mkdirSync(root + "/state/executions", {
    recursive: true
  });
  fs.writeFileSync(root + "/state/executions/goal-1.json", JSON.stringify({
    evidence: [{
      id: "event-1",
      at: "2026-01-01T00:00:01.000Z",
      tool: "read",
      args: "{}",
      result: JSON.stringify({
        ok: true
      }),
      error: false
    }]
  }));
  const app = await start({
    root,
    ncClient: nc,
    port: 0,
    token: "fixture"
  });
  try {
    const base = `http://127.0.0.1:${app.address().port}`;
    assert.equal((await fetch(base + "/api/ui/goals")).status, 401);
    const response = await fetch(base + "/api/ui/goals", {
      headers: {
        Authorization: "Bearer fixture"
      }
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.length, 2);
    const goal = body.find((x) => x.id === "goal-1");
    assert.equal(goal.status, "NEEDS-ACTION");
    assert.equal(goal.persistentStatus, "NEEDS-ACTION");
    assert.equal(goal.liveExecution.state, "idle");
    assert.deepEqual(goal.acceptanceCriteria.map((x) => x.id), ["criterion-1"]);
    assert.equal(goal.activity.count, 1);
    assert.equal(goal.activity.items[0].tool, "read");
    assert.equal(goal.session.id, "conv-1");
    const expanded = await (await fetch(base + "/api/ui/goals/goal-1/history?limit=10&expand=1", {
      headers: {
        Authorization: "Bearer fixture"
      }
    })).json();
    assert.deepEqual(expanded.items[0].result, {
      ok: true
    });
  } finally {
    await new Promise((resolve) => app.close(resolve));
  }
});
