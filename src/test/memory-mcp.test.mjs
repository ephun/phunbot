import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {Memory} from '../memory.mjs';
test('local memory MCP exposes real note readback without advertising absent integration credentials',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'phunbot-memory-mcp-'));const memory=new Memory(root);memory.put('utc','UTC incident timestamps','The owner prefers incident timestamps in UTC.','Explicit controlled owner fixture');
 const transport=new StdioClientTransport({command:process.execPath,args:[new URL('../mcp.mjs',import.meta.url).pathname],env:{PATH:process.env.PATH,HOME:process.env.HOME,PHUNBOT_ROOT:root},stderr:'pipe'}),client=new Client({name:'phunbot-memory-acceptance',version:'1.0.0'});
 try{await client.connect(transport);const tools=(await client.listTools()).tools.map(t=>t.name);assert.ok(tools.includes('memory_read'));assert.ok(!tools.includes('nextcloud_goals'));assert.ok(!tools.includes('n8n_workflows'));const result=await client.callTool({name:'memory_read',arguments:{id:'utc'}});assert.equal(result.isError,undefined);const note=JSON.parse(result.content[0].text);assert.match(note.markdown,/UTC/);assert.match(note.markdown,/Explicit controlled owner fixture/);}finally{await client.close();await transport.close();}
});
