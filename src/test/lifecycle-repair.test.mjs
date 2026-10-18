import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planningProperties,parsePlanningDecision} from '../planning-decision.mjs';
import {planGoal,reviewGoalAnswer} from '../planning.mjs';
const valid=(kind='answer_quality')=>({title:'Respond',description:'Answer the original request',criteria:[{title:'Requested answer delivered',verifier:{kind,path:kind==='file_contains'?'answer.txt':'',text:kind==='file_contains'?'observed':''}}],subgoals:[],changes:[],execution:'continue'});
const result=v=>({stopReason:'stop',content:[{type:'text',text:JSON.stringify(v)}]});
import {Controller} from '../controller.mjs';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const policy={provider:'fixture',roles:{planner:'fast',reviewer:'fast'}};
test('provider resolution after cancellation cannot accept a plan or reviewer verdict',async()=>{
 for(const kind of ['plan','review']){const ac=new AbortController();const records=[];const rt={getModel:()=>({id:'fast'}),completeSimple:async()=>{ac.abort();return result(kind==='plan'?valid():{pass:true,reason:'late verdict'});}};await assert.rejects(kind==='plan'?planGoal(rt,policy,{request:'Hi.'},[],[],[],ac.signal,{onAttempt:r=>records.push(r)}):reviewGoalAnswer(rt,policy,{},[],{},ac.signal),{name:'AbortError'});if(kind==='plan'){assert.equal(records.length,1);assert.equal(records[0].category,'cancelled');}}
});
test('diagnostic persistence failures cannot cause another provider invocation',async()=>{
 let calls=0;const rt={getModel:()=>({id:'fast'}),completeSimple:async()=>{calls++;return result(valid());}};
 await assert.rejects(planGoal(rt,policy,{request:'Hi.'},[],[],[],undefined,{onAttempt:()=>{throw Error('diagnostic write failed');}}),/diagnostic write failed/);assert.equal(calls,1);
});
test('planner notices report actual attempts and category without blaming user context',async()=>{
 const {plannerFailureNotice}=await import('../planning.mjs');assert.equal(typeof plannerFailureNotice,'function');
 const text=plannerFailureNotice({attempts:1,code:'planner_transport_failed',category:'permanent_request'});assert.match(text,/1 attempt/);assert.match(text,/provider rejected/i);assert.doesNotMatch(text,/more context|two attempts/);
});
test('memory context is not independent evidence of an external outcome',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'phunbot-memory-evidence-'));const rows=new Map();let version=0;const nc={get:async id=>structuredClone(rows.get(id)),list:async()=>structuredClone([...rows.values()]),put:async d=>{const x={...structuredClone(d),etag:String(++version)};rows.set(x.id,x);return structuredClone(x);}};
 try{const c=new Controller(root,nc);const g=await c.create('Read the server hostname','fixture','fast');await c.applyPlanning(g.id,valid('evidence_review'),1);const current=await nc.get(g.id);c.record(g.id,'memory_context',{}, {notes:[{id:'facts',excerpt:'plausible text'}]});await assert.rejects(c.verify(g.id,current.expectedChildIds[0],async(t,events)=>({pass:true,reason:'self claim',evidenceIds:events.map(e=>e.id)})),/actual tool evidence required/);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('planner cannot resume an owner-paused goal through a decision',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'phunbot-paused-plan-'));const rows=new Map();let version=0;
 const nc={get:async id=>structuredClone(rows.get(id)),list:async()=>structuredClone([...rows.values()]),put:async d=>{const x={...structuredClone(d),etag:String(++version)};rows.set(x.id,x);return structuredClone(x);}};
 try{const c=new Controller(root,nc);const g=await c.create('Read a server','fixture','fast');await c.pause(g.id);const paused=await nc.get(g.id);await assert.rejects(c.applyPlanning(g.id,{...valid('evidence_review'),execution:'resume'},paused.revision),/resume|owner/i);assert.equal((await nc.get(g.id)).paused,true);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('accepted planner interpretation cannot overwrite the original user request',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'phunbot-original-'));const rows=new Map();let version=0;
 const nc={get:async id=>structuredClone(rows.get(id)),list:async()=>structuredClone([...rows.values()]),put:async d=>{const x={...structuredClone(d),etag:String(++version)};rows.set(x.id,x);return structuredClone(x);}};
 try{const c=new Controller(root,nc);const g=await c.create('Tell me who you are.','fixture','fast');const d=valid();d.description='A planner interpretation';await c.applyPlanning(g.id,d,1);const stored=await nc.get(g.id);assert.equal(stored.request,'Tell me who you are.');assert.equal(stored.description,d.description);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('planner and reviewer receive explicit bounded knowledge without inheriting private runtime traces',async()=>{
 let context;const rt={getModel:()=>({id:'fast'}),completeSimple:async(m,c)=>{context=c;return result(valid());}};
 const knowledge={identity:{id:'phunbot-identity',excerpt:'phunbot is the personal assistant.'},procedure:{id:'goal-planning-procedure',excerpt:'Use the simplest sufficient plan.'},capabilities:[{name:'read',description:'Read workspace files'}],memoryEvidence:[{id:'user-facts',version:'fixture',excerpt:'User likes tea.'}]};
 await planGoal(rt,policy,{request:'Hi.',requestHistory:[{text:'Hi.'}]},[],[],[],undefined,{knowledge});
 assert.deepEqual(JSON.parse(context.messages[0].content[0].text).operationalContext,knowledge);
 assert.match(context.systemPrompt,/phunbot/);assert.doesNotMatch(context.systemPrompt,/optional parentId/);
 rt.completeSimple=async(m,c)=>{context=c;return result({pass:true,reason:'Evidence supports it'});};
 await reviewGoalAnswer(rt,policy,{request:'What do you know about me?'},{title:'Grounded answer'},{result:'User likes tea.'},undefined,{supportingEvidence:knowledge.memoryEvidence,identity:knowledge.identity});
 assert.deepEqual(JSON.parse(context.messages[0].content[0].text).supportingEvidence,knowledge.memoryEvidence);
});
test('permanent provider errors suspend after one call with sanitized per-attempt diagnostics',async()=>{
 const attempts=[];let calls=0;const rt={getModel:()=>({id:'fast',provider:'fixture',api:'openai-completions'}),completeSimple:async()=>{calls++;throw Object.assign(new Error('PRIVATE_SENTINEL Bearer do-not-store'),{status:400});}};
 await assert.rejects(planGoal(rt,policy,{id:'g',revision:3,request:'Hi.'},[],[],[],undefined,{onAttempt:a=>attempts.push(a)}),e=>e instanceof Error&&e.code==='planner_transport_failed');
 assert.equal(calls,1);assert.equal(attempts.length,1);assert.equal(attempts[0].category,'permanent_request');assert.equal(attempts[0].httpStatus,400);assert.equal(attempts[0].revision,3);assert.ok(!JSON.stringify(attempts).includes('PRIVATE_SENTINEL'));
});
test('transient thrown failures receive bounded retries and retain both attempt outcomes',async()=>{
 const attempts=[];let calls=0;const rt={getModel:()=>({id:'fast'}),completeSimple:async()=>{calls++;if(calls===1)throw Object.assign(new Error('unavailable'),{status:503});return result(valid());}};
 assert.deepEqual(await planGoal(rt,policy,{id:'g',revision:1,request:'Hi.'},[],[],[],undefined,{onAttempt:a=>attempts.push(a)}),valid());
 assert.deepEqual(attempts.map(a=>a.category),['server','accepted']);assert.equal(attempts[0].retry,'retry');assert.equal(attempts[1].retry,'none');
});
test('explicit non-thinking chat planning keeps schema and does not send chat flags to Responses',async()=>{
 for(const payload of [{messages:[]},{input:[]}]){
  const rt={getModel:()=>({id:'fast'}),completeSimple:async(m,c,o)=>{const wire=o.onPayload(payload);if('messages' in payload){assert.equal(wire.chat_template_kwargs.enable_thinking,false);assert.equal(wire.response_format.type,'json_schema');}else{assert.equal(wire.chat_template_kwargs,undefined);assert.equal(wire.text.format.type,'json_schema');}return result(valid());}};
  await planGoal(rt,{...policy,planning:{enableThinking:false}},{request:'Hi.'},[],[],[]);
 }
});
test('external goal planner rejects answer-only verification and repairs against the actual controller contract',async()=>{
 let calls=0;const contexts=[];const rt={getModel:()=>({id:'fast'}),completeSimple:async(m,c)=>{contexts.push(c);return result(++calls===1?valid():valid('evidence_review'));}};
 const plan=await planGoal(rt,policy,{id:'g',request:'Read the hostname using the available tool and report it'},[],[],[]);
 assert.equal(calls,2);assert.equal(plan.criteria[0].verifier.kind,'evidence_review');assert.match(contexts[1].systemPrompt,/external_evidence_required/);
});
test('wire schema expresses exactly the verifier field conditions, with required nullable parentId',()=>{
 const schema=planningProperties.criteria.items.properties.verifier;
 assert.ok(Array.isArray(schema.anyOf),'verifier schema must encode conditional variants');assert.equal(schema.anyOf.length,2);
 const file=schema.anyOf.find(s=>s.properties.kind.enum.includes('file_contains'));
 const other=schema.anyOf.find(s=>s.properties.kind.enum.includes('answer_quality'));
 assert.equal(file.properties.path.minLength,1);
 assert.deepEqual(other.properties.path.enum,['']);assert.deepEqual(other.properties.text.enum,['']);
 assert.ok(planningProperties.subgoals.items.required.includes('parentId'));
 for(const kind of ['answer_quality','evidence_review','file_contains'])assert.deepEqual(parsePlanningDecision(result(valid(kind))),valid(kind));
 const bad=valid();bad.criteria[0].verifier.path='invented';assert.throws(()=>parsePlanningDecision(result(bad)));
});
