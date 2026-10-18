import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planGoal} from '../planning.mjs';
const policy={provider:'fixture',roles:{planner:'fast'},planning:{timeoutMs:15}};
const valid={title:'Answer',description:'Answer request',criteria:[{title:'Answer delivered',verifier:{kind:'answer_quality',path:'',text:''}}],subgoals:[],changes:[],execution:'continue'};
const response={stopReason:'stop',content:[{type:'text',text:JSON.stringify(valid)}]};
test('rate limit and stream failure keep distinct bounded attempt diagnostics',async()=>{
 for(const [error,expected] of [[Object.assign(Error('limited'),{status:429}),'rate_limit'],[Error('Invalid stream output_index'),'stream_protocol']]){
  const records=[];let calls=0;const rt={getModel:()=>({id:'fast'}),completeSimple:async()=>{if(++calls===1)throw error;return response;}};
  await planGoal(rt,policy,{id:'g',request:'Hi.'},[],[],[],undefined,{onAttempt:r=>records.push(r)});
  assert.equal(calls,2);assert.equal(records[0].category,expected);assert.equal(records[1].category,'accepted');
 }
});
test('deadline after provider work returns cannot accept a plan or trigger another call',async()=>{
 const records=[];let calls=0;const rt={getModel:()=>({id:'fast'}),completeSimple:async()=>{calls++;await new Promise(r=>setTimeout(r,30));return response;}};
 await assert.rejects(planGoal(rt,policy,{id:'g',request:'Hi.'},[],[],[],undefined,{onAttempt:r=>records.push(r)}),e=>e.code==='planner_transport_failed');
 assert.equal(calls,1);assert.equal(records[0].category,'timeout');
});
test('programming exceptions are not blindly retried as provider outages',async()=>{
 const records=[];let calls=0;const rt={getModel:()=>({id:'fast'}),completeSimple:async()=>{calls++;throw new ReferenceError('PRIVATE_IMPLEMENTATION_DETAIL');}};
 await assert.rejects(planGoal(rt,policy,{id:'g',request:'Hi.'},[],[],[],undefined,{onAttempt:r=>records.push(r)}));
 assert.equal(calls,1);assert.equal(records[0].category,'unexpected_exception');assert.doesNotMatch(JSON.stringify(records),/PRIVATE_IMPLEMENTATION_DETAIL/);
});
