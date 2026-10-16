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

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-ui-folders-"));
  const server = await start({
    root,
    port: 0,
    token: "fixture"
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = (url, options = {}) => fetch(base + url, {
    ...options,
    headers: {
      Authorization: "Bearer fixture",
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
  });
  return {
    root,
    server,
    api
  };
}

test("folders require authentication and persist create rename move and delete", async () => {
  const f = await fixture();
  try {
    assert.equal((await fetch(new URL("/api/folders", "http://127.0.0.1:" + f.server.address().port))).status, 401);
    let r = await f.api("/api/folders", {
      method: "POST",
      body: JSON.stringify({
        name: "Research"
      })
    });
    assert.equal(r.status, 201);
    const folder = await r.json();
    assert.equal(folder.name, "Research");
    r = await f.api("/api/folders", {
      method: "POST",
      body: JSON.stringify({
        name: "Nested",
        parentId: folder.id
      })
    });
    assert.equal(r.status, 201);
    const nested = await r.json();
    r = await f.api(`/api/folders/${folder.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: "Renamed"
      })
    });
    assert.equal((await r.json()).name, "Renamed");
    r = await f.api(`/api/folders/${nested.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        parentId: null
      })
    });
    assert.equal((await r.json()).parentId, null);
    assert.equal((await (await f.api("/api/folders")).json()).length, 2);
    await new Promise((resolve) => f.server.close(resolve));
    const restarted = await start({
      root: f.root,
      port: 0,
      token: "fixture"
    });
    try {
      assert.deepEqual((await (await fetch(`http://127.0.0.1:${restarted.address().port}/api/folders`, {
        headers: {
          Authorization: "Bearer fixture"
        }
      })).json()).map((x) => x.name).sort(), ["Nested", "Renamed"]);
    } finally {
      await new Promise((resolve) => restarted.close(resolve));
    }
  } finally {
    if (f.server.listening) await new Promise((resolve) => f.server.close(resolve));
  }
});

test("folder mutations reject duplicates, cycles, deleting nonempty folders and unknown parents", async () => {
  const f = await fixture();
  try {
    const a = await (await f.api("/api/folders", {
      method: "POST",
      body: JSON.stringify({
        name: "A"
      })
    })).json();
    const b = await (await f.api("/api/folders", {
      method: "POST",
      body: JSON.stringify({
        name: "B",
        parentId: a.id
      })
    })).json();
    assert.equal((await f.api("/api/folders", {
      method: "POST",
      body: JSON.stringify({
        name: "a"
      })
    })).status, 409);
    assert.equal((await f.api(`/api/folders/${a.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        parentId: b.id
      })
    })).status, 409);
    assert.equal((await f.api(`/api/folders/${a.id}`, {
      method: "DELETE"
    })).status, 409);
    assert.equal((await f.api(`/api/folders/${b.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        parentId: "missing"
      })
    })).status, 400);
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
  }
});
