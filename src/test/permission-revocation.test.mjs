import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Permissions} from '../permissions.mjs';
test('revoking the current management policy fences an already signed durable scope',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'phunbot-revoke-'));const nc={get:async()=>({id:'g',status:'NEEDS-ACTION'})};const p=new Permissions(nc,{record(){}},{root,policy:{ampManagement:true}});p.owner.initialize();fs.mkdirSync(root+'/config/secrets',{recursive:true});fs.writeFileSync(root+'/config/secrets/mcp.json',JSON.stringify({amp:{env:{AMP_URL:'https://amp.example.invalid'}}}));
 const scope=p.owner.sign({kind:'scope',id:'one',instanceId:'fixture',operations:['amp_create_directory'],pathPrefix:'validation',expiresAt:Date.now()+60000});fs.writeFileSync(root+'/config/owner-scopes.json',JSON.stringify([scope]));const args={instanceId:'fixture',path:'validation/one'};
 assert.equal((await p.check('mcp__amp__amp_create_directory',args,'g')).allowed,true);
 fs.writeFileSync(root+'/config/permissions.json',JSON.stringify({ampManagement:false}));
 assert.equal((await p.check('mcp__amp__amp_create_directory',args,'g')).allowed,false);
 fs.writeFileSync(root+'/config/permissions.json',JSON.stringify({ampManagement:true}));fs.writeFileSync(root+'/config/secrets/mcp.json',JSON.stringify({amp:{env:{AMP_URL:'http://192.0.2.5:6464'}}}));
 assert.equal((await p.check('mcp__amp__amp_create_directory',args,'g')).allowed,false);
});
