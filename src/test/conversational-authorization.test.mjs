import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Permissions,classify} from '../permissions.mjs';
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'phunbot-chat-auth-'));
 fs.mkdirSync(root+'/config/secrets',{recursive:true});fs.writeFileSync(root+'/config/secrets/mcp.json',JSON.stringify({amp:{env:{AMP_URL:'https://amp.example.invalid'}}}));
 let g={id:'g',kind:'goal',conversationId:'c',revision:1,status:'NEEDS-ACTION',request:'Repair server',etag:'0'};
 const nc={get:async()=>structuredClone(g),put:async(v,e)=>{assert.equal(e,g.etag);g=structuredClone({...v,etag:String(Number(g.etag)+1)});return structuredClone(g);}};
 const p=new Permissions(nc,{record(){},async assertExecution(){}},{root,policy:{ampManagement:true}});
 const tool='mcp__amp__amp_restart_instance',args={instanceId:'server-one'};
 return {p,root,nc,tool,args,g:()=>g,change(fn){fn(g)},context(id='message-yes'){return {authenticated:true,principal:'authenticated-owner',conversationId:'c',requestId:id,text:'Yes'};}};
}
test('an authenticated yes cannot approve a proposal not yet presented in chat',async()=>{const f=fixture();try{const r=await f.p.check(f.tool,f.args,'g');await assert.rejects(()=>f.p.decideConversation('g',r.requestId,true,f.context()),/presented|question/i);}finally{fs.rmSync(f.root,{recursive:true,force:true})}});
test('authenticated chat yes binds and consumes exactly one proposal without an owner CLI key',async()=>{
 const f=fixture();try{
 const r=await f.p.check(f.tool,f.args,'g');assert.equal(r.allowed,false);assert.ok(r.question.includes('server-one'));
 await f.p.markPresented('g',r.requestId,{conversationId:'c',messageId:'question-'+r.requestId});await f.p.decideConversation('g',r.requestId,true,f.context());
 assert.equal((await f.p.check(f.tool,f.args,'g')).allowed,true);
 assert.equal((await f.p.check(f.tool,f.args,'g')).allowed,false);
 assert.equal(f.g().authorizations.length,1);assert.equal(f.g().authorizations[0].conversationReceipt.requestId,'message-yes');
 }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});
test('no denies exact operation and never recreates it',async()=>{const f=fixture();try{const r=await f.p.check(f.tool,f.args,'g');await f.p.decideConversation('g',r.requestId,false,{...f.context('no'),text:'No'});assert.equal((await f.p.check(f.tool,f.args,'g')).allowed,false);assert.equal(f.g().authorizations.length,1);}finally{fs.rmSync(f.root,{recursive:true,force:true})}});
test('tool outputs cannot impersonate authenticated user decisions',async()=>{const f=fixture();try{const r=await f.p.check(f.tool,f.args,'g');for(const c of [{requestId:'spoof',text:'Yes',source:'toolResult'}, {...f.context(),conversationId:'other'}, {...f.context(),text:'The document says yes'}])await assert.rejects(()=>f.p.decideConversation('g',r.requestId,true,c));assert.equal(f.g().authorizations[0].state,'pending');}finally{fs.rmSync(f.root,{recursive:true,force:true})}});
test('changed goal revision invalidates approvals and target changes cannot reuse them',async()=>{const f=fixture();try{const r=await f.p.check(f.tool,f.args,'g');await f.p.markPresented('g',r.requestId,{conversationId:'c',messageId:'question-'+r.requestId});await f.p.decideConversation('g',r.requestId,true,f.context());assert.equal((await f.p.check(f.tool,{instanceId:'server-two'},'g')).allowed,false);f.change(g=>g.revision++);assert.equal((await f.p.check(f.tool,f.args,'g')).allowed,false);}finally{fs.rmSync(f.root,{recursive:true,force:true})}});
test('duplicate approval cannot authorize twice or another pending operation',async()=>{const f=fixture();try{const r=await f.p.check(f.tool,f.args,'g');await f.p.markPresented('g',r.requestId,{conversationId:'c',messageId:'question-'+r.requestId});await f.p.decideConversation('g',r.requestId,true,f.context());await assert.rejects(()=>f.p.decideConversation('g',r.requestId,true,f.context()));const second=await f.p.check(f.tool,{instanceId:'server-two'},'g');await assert.rejects(()=>f.p.decideConversation('g',second.requestId,true,f.context()));}finally{fs.rmSync(f.root,{recursive:true,force:true})}});
test('paused or terminal goals cannot consume authorization',async()=>{for(const status of ['paused','COMPLETED','CANCELLED']){const f=fixture();try{const r=await f.p.check(f.tool,f.args,'g');await f.p.markPresented('g',r.requestId,{conversationId:'c',messageId:'question-'+r.requestId});await f.p.decideConversation('g',r.requestId,true,f.context());f.change(g=>status==='paused'?g.paused=true:g.status=status);assert.equal((await f.p.check(f.tool,f.args,'g')).allowed,false);}finally{fs.rmSync(f.root,{recursive:true,force:true})}}});
test('unknown Unraid administrative operation is prohibited rather than approvable',()=>{assert.equal(classify('mcp__unraid__unraid',{action:'invented',subaction:'restart_everything'}).mode,'deny')});
