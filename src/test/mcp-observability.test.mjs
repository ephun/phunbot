import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {summarizeMcpConfig} from '../mcp-observability.mjs';

test('summarizes safe MCP config metadata without secrets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phunbot-mcp-'));
  const file = path.join(dir, 'mcp.json');
  const sentinel = 'SECRET_SENTINEL_DO_NOT_LEAK';
  fs.writeFileSync(file, JSON.stringify({
    mcpServers: {
      alpha: {command: 'ignored', args: [sentinel], enabled: true, exposure: 'direct', headers: {Authorization: sentinel}},
      beta: {url: 'https://example.invalid/private', enabled: false, exposure: 'hidden', auth: {token: sentinel}},
    },
  }));
  const result = summarizeMcpConfig(dir);
  assert.deepEqual(result, {
    path: file,
    readable: true,
    present: true,
    errorCode: null,
    parseable: true,
    mcpServersObject: true,
    servers: [
      {name: 'alpha', disabled: false, exposure: 'direct'},
      {name: 'beta', disabled: true, exposure: 'hidden'},
    ],
  });
  assert.doesNotMatch(JSON.stringify(result), /SECRET_SENTINEL|example\.invalid|ignored|Authorization|token/);
});

test('reports malformed and missing configs without parse details', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phunbot-mcp-'));
  const malformed = path.join(dir, 'mcp.json');
  fs.writeFileSync(malformed, '{"mcpServers": {"bad": SECRET_SENTINEL');
  const bad = summarizeMcpConfig(dir);
  assert.equal(bad.present, true);
  assert.equal(bad.readable, true);
  assert.equal(bad.parseable, false);
  assert.equal(bad.mcpServersObject, null);
  assert.equal(bad.errorCode, 'INVALID_JSON');
  assert.doesNotMatch(JSON.stringify(bad), /SECRET_SENTINEL|Unexpected|bad/);
  fs.rmSync(malformed);
  const missing = summarizeMcpConfig(dir);
  assert.deepEqual(missing, {path: malformed, readable: false, present: false, errorCode: 'ENOENT', parseable: null, mcpServersObject: null, servers: []});
});

test('reports a non-object mcpServers value without exposing config values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phunbot-mcp-'));
  const file = path.join(dir, 'mcp.json');
  fs.writeFileSync(file, JSON.stringify({mcpServers: ['SECRET_SENTINEL']}));
  const result = summarizeMcpConfig(dir);
  assert.equal(result.parseable, true);
  assert.equal(result.mcpServersObject, false);
  assert.equal(result.errorCode, 'MCP_SERVERS_NOT_OBJECT');
  assert.deepEqual(result.servers, []);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_SENTINEL/);
});
