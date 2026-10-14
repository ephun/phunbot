import fs from 'node:fs';
import path from 'node:path';

const EXPOSURES = new Set(['direct', 'codemode', 'deferred', 'hidden']);

function object(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeExposure(value) {
  return EXPOSURES.has(value) ? value : 'codemode';
}

/** Return only non-sensitive metadata from an explicit agentDir/mcp.json. */
export function summarizeMcpConfig(agentDir) {
  const file = path.join(agentDir, 'mcp.json');
  const base = {path: file, readable: false, present: false, errorCode: null, parseable: null, mcpServersObject: null, servers: []};
  let text;
  try {
    fs.accessSync(file, fs.constants.R_OK);
    base.readable = true;
    base.present = true;
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    const code = error?.code;
    base.errorCode = code === 'ENOENT' ? 'ENOENT' : code === 'EACCES' ? 'EACCES' : 'READ_ERROR';
    return base;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
    base.parseable = true;
  } catch {
    base.parseable = false;
    base.errorCode = 'INVALID_JSON';
    return base;
  }
  const servers = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.mcpServers : undefined;
  if (!object(servers)) {
    base.mcpServersObject = false;
    base.errorCode = 'MCP_SERVERS_NOT_OBJECT';
    return base;
  }
  base.mcpServersObject = true;
  base.servers = Object.entries(servers).map(([name, config]) => ({
    name,
    disabled: object(config) && config.enabled === false,
    exposure: safeExposure(object(config) ? config.exposure : undefined),
  }));
  return base;
}
