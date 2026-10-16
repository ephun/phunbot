import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs";
import { Memory } from "./memory.mjs";
import { Nextcloud } from "./nextcloud.mjs";
const root = process.env.PHUNBOT_ROOT || "/data",
  memory = new Memory(root);
const tools = [
  {
    name: "memory_search",
    description: "Retrieve relevant notes from the sole Markdown memory vault.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "memory_read",
    description:
      "Read one authoritative Markdown note and its explicit relationships.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "memory_link",
    description:
      "Add reciprocal See also links only after evaluating a meaningful relationship; preserves human links.",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "string" },
        reason: { type: "string" },
      },
      required: ["a", "b", "reason"],
    },
  },
  {
    name: "nextcloud_goals",
    description:
      "Read phunbot own Nextcloud Tasks goal state. Does not grant personal account access.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "n8n_workflows",
    description:
      "List live n8n workflows through the configured authorized integration, without revealing credentials.",
    inputSchema: { type: "object", properties: {} },
  },
].filter(tool => {
  if(tool.name === 'nextcloud_goals') return fs.existsSync(root+'/config/secrets/nextcloud.json');
  if(tool.name === 'n8n_workflows') return fs.existsSync(root+'/config/secrets/n8n.json');
  return true;
});
const server = new Server(
  { name: "phunbot-capabilities", version: "0.1.0" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (r, extra) => {
  const a = r.params.arguments || {};
  const signal = extra.signal;
  signal?.throwIfAborted();
  try {
    let result;
    switch (r.params.name) {
      case "memory_search":
        result = memory.withContext({phase:"mcp"}, () => {
          const notes=memory.search(a.query);memory.recordContextSupply(notes,notes.map(n=>n.text).join("\n\n"));return notes;
        });
        break;
      case "memory_read":
        result = memory.withContext({phase:"mcp"}, () => {
          const text=memory.get(a.id);memory.recordContextSupply([{id:a.id,text}],text);return {id:a.id,markdown:text};
        });
        break;
      case "memory_link":
        result = memory.withContext({phase:"mcp"}, () => memory.link(a.a, a.b, a.reason));
        break;
      case "nextcloud_goals":
        result = await new Nextcloud(root).list(signal);
        break;
      case "n8n_workflows": {
        const s = JSON.parse(
          fs.readFileSync(root + "/config/secrets/n8n.json"),
        );
        let base;
        try { base = new URL(s.baseUrl); } catch { throw Error("Invalid n8n endpoint"); }
        const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
        if ((base.protocol !== "https:" && !(base.protocol === "http:" && loopback)) ||
            base.username || base.password || base.search || base.hash)
          throw Error("Invalid n8n endpoint");
        const endpoint = new URL(base.href.replace(/\/$/, "") + "/api/v1/workflows?limit=100");
        if (endpoint.origin !== base.origin) throw Error("Invalid n8n endpoint");
        const response = await fetch(
          endpoint,
          {
            redirect: "error",
            headers: { "X-N8N-API-KEY": s.apiKey },
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
              : AbortSignal.timeout(20000),
          },
        );
        if (!response.ok) throw Error("n8n returned " + response.status);
        const body = await response.json();
        result = {
          data: body.data.map((w) => ({
            id: w.id,
            name: w.name,
            active: w.active,
          })),
          nextCursor: body.nextCursor || null,
        };
        break;
      }
      default:
        throw Error("Unknown tool");
    }
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: e.message }] };
  }
});
await server.connect(new StdioServerTransport());
