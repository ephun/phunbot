import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
test('Nextcloud goals discovery does not require a private CA file', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nextcloud-mcp-discovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'config/secrets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config/secrets/nextcloud.json'), JSON.stringify({ baseUrl: 'https://cloud.example.invalid', username: 'fixture', password: 'fixture' }));
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../mcp.mjs', import.meta.url))], env: { PATH: process.env.PATH, PHUNBOT_ROOT: root }, stderr: 'pipe' });
  const client = new Client({ name: 'test', version: '1' });
  try { await client.connect(transport); const listed = await client.listTools(); assert.ok(listed.tools.some(tool => tool.name === 'nextcloud_goals')); }
  finally { await client.close(); await transport.close(); }
});

async function call(t, baseUrl) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "n8n-fixture-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "config/secrets"), { recursive: true });
  fs.writeFileSync(path.join(root, "config/secrets/n8n.json"), JSON.stringify({ baseUrl, apiKey: "CONTROLLED_API_KEY" }));
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL("../mcp.mjs", import.meta.url))], env: { PATH: process.env.PATH, PHUNBOT_ROOT: root }, stderr: "pipe" });
  const client = new Client({ name: "test", version: "1" });
  try { await client.connect(transport); return await client.callTool({ name: "n8n_workflows", arguments: {} }); }
  finally { await client.close(); await transport.close(); }
}
async function listen(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
test("n8n credentials never follow redirects to another endpoint", async (t) => {
  let received = 0;
  const other = await listen(t, (req, res) => { received++; res.end(JSON.stringify({ data: [] })); });
  const initial = await listen(t, (req, res) => { res.writeHead(302, { Location: other }); res.end(); });
  const result = await call(t, initial);
  assert.equal(received, 0);
  assert.equal(result.isError, true);
  assert.doesNotMatch(JSON.stringify(result), /CONTROLLED_API_KEY/);
});
test("n8n rejects credentials, query, fragments and plaintext non-loopback config", async (t) => {
  for (const url of ["http://192.0.2.1", "https://user:private@example.invalid", "https://example.invalid?apiKey=private", "https://example.invalid#private"]) {
    const result = await call(t, url);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Invalid n8n endpoint/);
    assert.doesNotMatch(JSON.stringify(result), /private|CONTROLLED_API_KEY/);
  }
});
