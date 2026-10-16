import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {start} from '../app.mjs';
import {GoalQueue, dryRunGoalMigration} from '../goal-queue.mjs';
import {Controller} from '../controller.mjs';
import {planGoal,reviewGoalAnswer} from '../planning.mjs';
import {deliverGoalRequests} from '../goal-delivery.mjs';
import {Agent} from '@earendil-works/pi-agent-core';

test('durable request delivery updates the installed native Pi agent context',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'phunbot-native-delivery-'));
 try {
  const manager=SessionManager.create(root,root+'/sessions');
  const agent=new Agent();
  const goal={id:'native-goal',requestHistory:[{requestId:'native-request',text:'Use the current instructions',images:[]}]};
  deliverGoalRequests({sessionManager:manager,agent},goal);
  assert.ok(agent.state.messages.some(m=>m.role==='user'&&m.phunbotRequestId==='native-request'));
  deliverGoalRequests({sessionManager:manager,agent},goal);
  assert.equal(agent.state.messages.filter(m=>m.phunbotRequestId==='native-request').length,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

class Tasks {
  data=new Map(); counter=0;
  async get(id){if(!this.data.has(id))throw Error('404');return structuredClone(this.data.get(id));}
  async list(){return structuredClone([...this.data.values()]);}
  async put(d,etag){const old=this.data.get(d.id);if(old ? old.etag!==etag : Boolean(etag))throw Error('412');const next={...structuredClone(d),etag:String(++this.counter)};this.data.set(d.id,next);return structuredClone(next);}
}
const input=(requestId,text='What is recursion?',conversationId='c')=>({requestId,text,conversationId,model:'fast'});
async function until(fn){for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Expected current state not reached');}
const decision=g=>({title:g.title,description:g.request,criteria:[{title:'Observe the requested outcome',verifier:{kind:'evidence_review'}}],subgoals:[],changes:['Incorporate revision '+g.revision],execution:g.paused?'pause':'continue'});
async function fixture({decisionFor=decision}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'phunbot-goal-native-'));
 fs.mkdirSync(root+'/config');fs.writeFileSync(root+'/config/policy.json',JSON.stringify({provider:'fixture',roles:{executor:'fast',reviewer:'deep'},limits:{maxActiveGoals:2,sliceMs:60000},maintenance:{}}));
 const nc=new Tasks(),plans=[],executions=[],managers=new Map(),releases=new Map();
 const server=await start({root,ncClient:nc,port:0,token:'fixture',sessionFactory:async row=>{
  const manager=SessionManager.create(root+'/work',root+'/state/pi-sessions');managers.set(row.id,manager);
  const act=async()=>{executions.push({conversationId:row.id,goalId:row.goalId});await new Promise(r=>releases.set(row.id,r));};
  return {busy:false,session:{sessionManager:manager,modelRuntime:{getModel:(provider,id)=>{assert.equal(provider,'fixture');assert.equal(id,'deep');return {id};},completeSimple:async (model,payload)=>{assert.equal(model.id,'deep');assert.match(payload.systemPrompt,/deep goal planner/);const {goal}=JSON.parse(payload.messages[0].content[0].text);plans.push(goal);return {content:[{type:'text',text:JSON.stringify(decisionFor(goal))}]};}},sendCustomMessage:async(_m,o)=>{if(o.triggerTurn)await act();},prompt:act,abort:async()=>releases.get(row.id)?.(),dispose:()=>releases.get(row.id)?.()}};
 }});
 const base='http://127.0.0.1:'+server.address().port;
 const api=async(url,body)=>{const r=await fetch(base+'/api/'+url,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};};
 return {root,nc,server,api,plans,executions,managers,async close(){for(const g of await nc.list())if(g.kind==='goal'&&!['COMPLETED','CANCELLED'].includes(g.status)){await api('sessions/'+g.conversationId+'/cancel',{goalId:g.id});}await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}};
}

test('actual deep planning precedes fast execution, unrelated followup replans the same parent and preserves native user messages',async()=>{
 const f=await fixture();try{
  const {data:c}=await f.api('sessions',{});
  const a=await f.api('sessions/'+c.id+'/send',input('a','Investigate external server access',c.id));assert.equal(a.status,202);
  await until(()=>f.executions.length===1);
  const b=await f.api('sessions/'+c.id+'/send',input('b','By the way, what does MCP stand for?',c.id));assert.equal(b.status,202);assert.equal(a.data.goalId,b.data.goalId);
  await until(()=>f.plans.length===2 && f.executions.length===2);
  assert.deepEqual(f.plans[1].requestHistory.map(r=>r.text),['Investigate external server access','By the way, what does MCP stand for?']);
  const g=await f.nc.get(a.data.goalId);assert.equal(g.revision,2);assert.equal(g.planRevision,2);assert.equal(g.planRevisions.length,2);
  const users=f.managers.get(c.id).getBranch().filter(e=>e.type==='message'&&e.message.role==='user');assert.equal(users.length,2);assert.deepEqual(users.map(e=>e.message.phunbotRequestId),['a','b']);
 }finally{await f.close();}
});

test('pause fences active work and unattended recovery, incidental input only plans, Resume keeps identity, terminal outcomes survive a fresh controller',async()=>{
 const f=await fixture();try{
  const {data:c}=await f.api('sessions',{});const a=await f.api('sessions/'+c.id+'/send',input('a',undefined,c.id));await until(()=>f.executions.length===1);
  assert.equal((await f.api('sessions/'+c.id+'/pause',{goalId:a.data.goalId})).status,200);
  await f.server.resumeGoals();assert.equal(f.executions.length,1);assert.equal((await f.nc.get(a.data.goalId)).paused,true);
  const b=await f.api('sessions/'+c.id+'/send',input('b','Just noting another question',c.id));assert.equal(b.data.goalId,a.data.goalId);
  await until(()=>f.plans.length===2 && f.plans[1].paused===true);await until(async()=>!(await f.api('sessions')).data.find(x=>x.id===c.id).busy);
  assert.equal(f.executions.length,1);assert.equal((await f.nc.get(a.data.goalId)).paused,true);
  assert.equal((await f.api('sessions/'+c.id+'/resume',{goalId:a.data.goalId})).status,200);await until(()=>f.executions.length===2);
  const criteria=(await f.nc.get(a.data.goalId)).expectedChildIds;await f.api('sessions/'+c.id+'/complete',{goalId:a.data.goalId});
  const fresh=new Controller(f.root,f.nc);assert.equal((await f.nc.get(a.data.goalId)).completionKind,'user-directed');assert.equal((await f.nc.get(criteria[0])).status,'NEEDS-ACTION');await assert.rejects(()=>fresh.resumeGoal(a.data.goalId),/terminal/);
  const next=await f.api('sessions/'+c.id+'/send',input('c','Additional research',c.id));assert.notEqual(next.data.goalId,a.data.goalId);await f.api('sessions/'+c.id+'/cancel',{goalId:next.data.goalId});
  await f.server.resumeGoals();assert.equal((await f.nc.get(next.data.goalId)).status,'CANCELLED');await assert.rejects(()=>fresh.resumeGoal(next.data.goalId),/terminal/);
 }finally{await f.close();}
});

test('different conversations execute concurrently within configured limits',async()=>{
 const f=await fixture();try{
  const {data:a}=await f.api('sessions',{}),{data:b}=await f.api('sessions',{});
  await f.api('sessions/'+a.id+'/send',input('a',undefined,a.id));await f.api('sessions/'+b.id+'/send',input('b',undefined,b.id));
  await until(()=>f.executions.length===2);assert.notEqual(f.executions[0].goalId,f.executions[1].goalId);
 }finally{await f.close();}
});

test('admission crash after reservation and ambiguous lost parent write recover one durable identity',async()=>{
 const nc=new Tasks();const q=new GoalQueue(nc);const put=nc.put.bind(nc);let once=true;
 nc.put=async(d,e)=>{if(d.kind==='goal'&&once){once=false;await put(d,e);throw Error('lost response');}return put(d,e);};
 await assert.rejects(()=>q.admit(input('a')),/lost response/);const retry=await new GoalQueue(nc).admit(input('a'));
 assert.equal((await nc.list()).filter(g=>g.kind==='goal').length,1);assert.equal(retry.requestReceipts.length,1);
 const initial=await nc.get(retry.id);await nc.put({...initial,status:'COMPLETED'},initial.etag);const next=await q.admit(input('b'));assert.notEqual(next.id,retry.id);assert.equal((await q.admit(input('a'))).id,retry.id);
});

test('overlapping independent dispatchers cannot create two open parents, and accepted retries retain both message IDs',async()=>{
 const nc=new Tasks();const a=new GoalQueue(nc),b=new GoalQueue(nc);
 const results=await Promise.allSettled([a.admit(input('a')),b.admit(input('b'))]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 const first=results.find(x=>x.status==='fulfilled').value;const missing=first.requestId==='a'?'b':'a';const retry=await b.admit(input(missing));
 assert.equal(retry.id,first.id);assert.equal(retry.requestReceipts.length,2);assert.equal((await nc.list()).filter(g=>g.kind==='goal').length,1);
});

test('deep plan revision retains useful accepted evidence and archives superseded criteria without erasing them',async()=>{
 const nc=new Tasks(),q=new GoalQueue(nc),root=fs.mkdtempSync(path.join(os.tmpdir(),'phunbot-replan-')),c=new Controller(root,nc);
 try{
  const g=await q.admit(input('a','Create the requested file'));
  const d={...decision(g),criteria:[{title:'File present',verifier:{kind:'file_contains',path:'result.txt',text:'yes'}}]};await c.applyPlanning(g.id,d,1);
  fs.mkdirSync(root+'/work',{recursive:true});fs.writeFileSync(root+'/work/result.txt','yes');const old=(await nc.get(g.id)).expectedChildIds[0];await c.verify(g.id,old);
  const accepted=await nc.get(old);const event=c.record(g.id,'read',{},'actual useful result');
  const revised=await q.admit(input('b','Also add a report'));
  await c.applyPlanning(g.id,{...d,criteria:[...d.criteria,{title:'Report present',verifier:{kind:'file_contains',path:'report.txt',text:'report'}}]},revised.revision);
  const current=await nc.get(g.id);assert.ok(current.expectedChildIds.includes(old));assert.deepEqual((await nc.get(old)).evidence,accepted.evidence);assert.equal(c.checkpoint(g.id).evidence[0].id,event.id);
  const again=await q.admit(input('c','Replace the original file requirement with the report only'));
  await c.applyPlanning(g.id,{...d,criteria:[{title:'Report present',verifier:{kind:'file_contains',path:'report.txt',text:'report'}}]},again.revision);
  const final=await nc.get(g.id);assert.equal(final.planRevisions.at(-1).criteria.find(t=>t.id===old).disposition,'superseded');assert.equal((await nc.get(old)).status,'COMPLETED');
  const reintroduced=await q.admit(input('d','Restore the original file criterion'));
  await c.applyPlanning(g.id,d,reintroduced.revision);
  const restored=await nc.get(g.id),fresh=await nc.get(restored.expectedChildIds[0]);
  assert.notEqual(fresh.id,old);assert.equal(fresh.status,'NEEDS-ACTION');assert.equal(c.criterionAccepted(restored,fresh),false);assert.equal((await nc.get(old)).status,'COMPLETED');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('a new instruction during independent verification fences obsolete receipts; pause does not wait for a model review',async()=>{
 const nc=new Tasks(),q=new GoalQueue(nc),root=fs.mkdtempSync(path.join(os.tmpdir(),'phunbot-review-fence-')),c=new Controller(root,nc);
 try{
  const g=await q.admit(input('a','Inspect actual state'));await c.applyPlanning(g.id,decision(g),1);const id=(await nc.get(g.id)).expectedChildIds[0];const event=c.record(g.id,'read',{},'real readback');
  let unblock,entered;const waiting=new Promise(r=>entered=r);const verifying=c.verify(g.id,id,async()=>{entered();await new Promise(r=>unblock=r);return {pass:true,reason:'old check',evidenceIds:[event.id]};});
  await waiting;await c.pause(g.id);assert.equal((await nc.get(g.id)).paused,true);unblock();await assert.rejects(()=>verifying,/paused|superseded|terminal/);assert.equal((await nc.get(g.id)).verificationReceipts?.[id],undefined);
  const revision=(await nc.get(g.id)).revision;await assert.rejects(()=>c.applyPlanning(g.id,decision(g),revision-1),/Stale/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('native request delivery is idempotent across reopened Pi history and retains attachments',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'phunbot-delivery-'));try{
 const manager=SessionManager.create(root,root+'/sessions');const goal={id:'g',requestHistory:[{requestId:'a',text:'actual user request',images:[{mimeType:'image/png',data:'AAAA'}]}]};
 deliverGoalRequests({sessionManager:manager},goal);deliverGoalRequests({sessionManager:manager},goal);
 const reopened=SessionManager.open(manager.getSessionFile());deliverGoalRequests({sessionManager:reopened},goal);assert.equal(reopened.getBranch().filter(e=>e.type==='message').length,1);
 assert.equal(reopened.getBranch().find(e=>e.type==='message').message.content[1].data,'AAAA');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('rapid messages serialize into one latest active plan',async()=>{
 const f=await fixture();try{
  const {data:c}=await f.api('sessions',{});
  const replies=await Promise.all(['a','b','c'].map(id=>f.api('sessions/'+c.id+'/send',input(id,'Inspect requested state '+id,c.id))));
  assert.ok(replies.every(r=>r.status===202));const ids=new Set(replies.map(r=>r.data.goalId));assert.equal(ids.size,1);
  const id=replies[0].data.goalId;await until(async()=>{const g=await f.nc.get(id);return g.revision===3&&g.planRevision===3&&!g.needsPlanning;});
  const g=await f.nc.get(id);assert.equal(g.requestReceipts.length,3);assert.equal(g.requestHistory.length,3);assert.equal(g.lease.revision,3);
  assert.equal((await f.nc.list()).filter(g=>g.kind==='goal'&&!['COMPLETED','CANCELLED'].includes(g.status)).length,1);
 }finally{await f.close();}
});

test('isolated legacy copies reconcile exact catalog/checkpoint associations without losing history or writing production',async()=>{
 const original=[{id:'legacy',kind:'goal',status:'NEEDS-ACTION',request:'Original request',expectedChildIds:['criterion'],verificationReceipts:{criterion:'receipt'}},{id:'criterion',kind:'criterion',parent:'legacy',status:'COMPLETED',evidence:{kind:'fixture',value:'preserved'}},{id:'terminal',kind:'goal',status:'COMPLETED',completionKind:'verified'}];
 const copy=structuredClone(original);const report=dryRunGoalMigration(copy,[{id:'conversation',sessionFile:'exact-session-reference'}],id=>id==='legacy'?{sessionFile:'exact-session-reference'}:{});
 assert.equal(report.safe,true);assert.equal(report.writes,0);assert.deepEqual(original,copy);assert.deepEqual(report.assignments,[{goalId:'legacy',conversationId:'conversation'}]);
 const nc=new Tasks();for(const row of copy)await nc.put(row);const old=await nc.get('legacy');await nc.put({...old,conversationId:report.assignments[0].conversationId},old.etag);
 const migrated=await nc.get('legacy');assert.equal(migrated.id,'legacy');assert.deepEqual(migrated.verificationReceipts,original[0].verificationReceipts);assert.deepEqual((await nc.get('criterion')).evidence,original[1].evidence);assert.equal((await nc.get('terminal')).status,'COMPLETED');
 assert.equal(dryRunGoalMigration(original,[],()=>({})).safe,false);
});

test('revised informational descriptions verify contributing requests rather than rejecting their combined summary',async()=>{
 const nc=new Tasks(),q=new GoalQueue(nc),root=fs.mkdtempSync(path.join(os.tmpdir(),'phunbot-info-replan-')),c=new Controller(root,nc);
 try {
  const initial=await q.admit(input('a','What is recursion?'));
  const d={...decision(initial),criteria:[{title:'Explain recursion',verifier:{kind:'answer_quality'}}]};await c.applyPlanning(initial.id,d,1);
  const revised=await q.admit(input('b','Define MCP'));
  await c.applyPlanning(initial.id,{...d,description:'Explain recursion and define MCP',criteria:[...d.criteria,{title:'Define MCP',verifier:{kind:'answer_quality'}}]},revised.revision);
  c.record(initial.id,'assistant_output',{}, {final:true,source:'Actual Pi assistant output; not independent proof of external state',text:'Recursion solves a problem by calling itself on smaller instances until a base case. MCP stands for Model Context Protocol and connects AI applications with tools and contextual data.'});
  const first=(await nc.get(initial.id)).expectedChildIds[0];
  await assert.rejects(()=>c.verify(initial.id,first),/Independent review required/);
  c.answerReviewer=async()=>({pass:false,reason:'Controlled rejection'});
  await assert.rejects(()=>c.verify(initial.id,first),/Independent answer review rejected/);
  assert.equal((await nc.get(initial.id)).verificationReceipts?.[first],undefined);
  c.answerReviewer=async(_g,t)=>({pass:true,reason:'Controlled independent review of '+t.title});
  for(const id of (await nc.get(initial.id)).expectedChildIds)await c.verify(initial.id,id);
  assert.equal((await c.settle(initial.id)).reason,'verified_complete');
  assert.equal((await nc.get(initial.id)).status,'COMPLETED');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('contributing image metadata still requires visual evidence and cannot use answer-quality acceptance',async()=>{
 const nc=new Tasks(),q=new GoalQueue(nc),root=fs.mkdtempSync(path.join(os.tmpdir(),'phunbot-visual-contract-')),c=new Controller(root,nc);
 try {
  const g=await q.admit({...input('a','What is this?'),images:[{mimeType:'image/png',data:'AAAA'}]});
  await assert.rejects(()=>c.applyPlanning(g.id,{...decision(g),criteria:[{title:'Identify picture',verifier:{kind:'answer_quality'}}]},1),/actual evidence required/);
  assert.equal((await nc.get(g.id)).planReady,undefined);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('combined arithmetic retains every independently computed result and still requires deep review',async()=>{
 const nc=new Tasks(),q=new GoalQueue(nc),root=fs.mkdtempSync(path.join(os.tmpdir(),'phunbot-combined-math-')),c=new Controller(root,nc);
 try {
  const g=await q.admit(input('a','Calculate 2+2'));const next=await q.admit(input('b','Calculate 3+5'));
  await c.applyPlanning(g.id,{...decision(next),description:'Calculate both sums',criteria:[{title:'Answer both sums',verifier:{kind:'answer_quality'}}]},next.revision);
  const criterion=(await nc.get(g.id)).expectedChildIds[0];c.answerReviewer=async()=>({pass:true,reason:'Controlled deep arithmetic coverage check'});
  const emit=text=>c.record(g.id,'assistant_output',{}, {final:true,source:'Actual Pi assistant output; not independent proof of external state',text});
  emit('The first sum is 4.');await assert.rejects(()=>c.verify(g.id,criterion),/independently computed arithmetic result/);
  emit('The first sum is 4 and the second sum is 8.');const verified=await c.verify(g.id,criterion);assert.deepEqual(verified.evidence.expectedResults,[4,8]);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('planning and answer verification use separate configured deep operations and malformed plans fail closed',async()=>{
 const calls=[];const runtime={getModel:(provider,id)=>{assert.equal(provider,'configured');assert.equal(id,'deep');return {id};},completeSimple:async(_m,p)=>{calls.push(p);return {content:[{type:'text',text:JSON.stringify(p.systemPrompt.includes('deep goal planner')?decision({title:'Q',request:'What is recursion?'}):{pass:true,reason:'Answer independently checked'})}]};}};
 const policy={provider:'configured',roles:{executor:'fast',reviewer:'deep'}};
 await planGoal(runtime,policy,{request:'What is recursion?'},[],[],[]);await reviewGoalAnswer(runtime,policy,{}, {},{tool:'assistant_output'});assert.equal(calls.length,2);assert.notEqual(calls[0].systemPrompt,calls[1].systemPrompt);
 await assert.rejects(()=>planGoal({...runtime,completeSimple:async()=>({content:[{type:'text',text:'{"title":"x"}'}]})},policy,{},[],[],[]),/Invalid structured/);
});
