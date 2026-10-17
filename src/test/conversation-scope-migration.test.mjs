import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {Permissions} from '../permissions.mjs';
test('legacy durable scopes cannot bypass one-use conversation approval',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'phunbot-retired-scope-'));
 try {let g={id:'g',conversationId:'c',revision:1,status:'NEEDS-ACTION',request:'Repair server',etag:'1'};
 const nc={get:async()=>structuredClone(g),put:async(v)=>{g=structuredClone(v);return structuredClone(g)}};
 const p=new Permissions(nc,{record(){}},{root,policy:{ampManagement:true}});p.owner.initialize();fs.mkdirSync(root+'/config/secrets',{recursive:true});fs.writeFileSync(root+'/config/secrets/mcp.json',JSON.stringify({amp:{env:{AMP_URL:'https://amp.example.invalid'}}}));
 fs.writeFileSync(root+'/config/owner-scopes.json',JSON.stringify([p.owner.sign({kind:'scope',id:'old',instanceId:'fixture',operations:['amp_create_directory'],pathPrefix:'validation',expiresAt:Date.now()+60000})]));
 assert.equal((await p.check('mcp__amp__amp_create_directory',{instanceId:'fixture',path:'validation/one'},'g')).allowed,false);assert.equal(g.authorizations[0].state,'pending');
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
