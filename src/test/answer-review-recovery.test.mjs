import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewGoalAnswer} from '../planning.mjs';
const policy={provider:'fixture',roles:{reviewer:'independent'}};
const goal={request:'Hi.',requestHistory:[{text:'Hi.'}],revision:1};
const criterion={title:'Friendly greeting',verifier:{kind:'answer_quality'}};
const event={id:'actual-reply',tool:'reply',result:{kind:'answer',text:'Hi!',published:true}};
const response=text=>({stopReason:'stop',content:[{type:'text',text}]});
test('empty independent verdict gets one bounded contract-repair attempt on the same evidence',async()=>{
  const prompts=[];
  const rt={getModel:()=>({id:'independent'}),completeSimple:async(_m,c)=>{prompts.push(c);return prompts.length===1?response(''):response('{"pass":true,"reason":"Actual greeting meets the criterion"}');}};
  const verdict=await reviewGoalAnswer(rt,policy,goal,criterion,event);
  assert.equal(verdict.pass,true); assert.equal(prompts.length,2);
  assert.notEqual(prompts[0].systemPrompt,prompts[1].systemPrompt);
  assert.deepEqual(prompts[0].messages,prompts[1].messages);
});
test('two invalid independent verdicts fail closed without surfacing raw model output',async()=>{
  let calls=0;
  const rt={getModel:()=>({id:'independent'}),completeSimple:async()=>{calls++;return response('PRIVATE_SENTINEL_NOT_JSON');}};
  await assert.rejects(reviewGoalAnswer(rt,policy,goal,criterion,event),e=>e.name==='ReviewParseError' && !e.message.includes('PRIVATE_SENTINEL'));
  assert.equal(calls,2);
});
test('an independent rejection is final and is never retried into approval',async()=>{
  let calls=0;const rt={getModel:()=>({id:'independent'}),completeSimple:async()=>{calls++;return response('{"pass":false,"reason":"Does not answer the request"}');}};
  assert.equal((await reviewGoalAnswer(rt,policy,goal,criterion,event)).pass,false);
  assert.equal(calls,1);
});
test('a failed reviewer transport can never supply an accepting verdict',async()=>{
  let calls=0;const rt={getModel:()=>({id:'independent'}),completeSimple:async()=>{calls++;return {...response('{"pass":true,"reason":"Not a valid response"}'),stopReason:'error',errorMessage:'PRIVATE_PROVIDER_SENTINEL'};}};
  await assert.rejects(reviewGoalAnswer(rt,policy,goal,criterion,event),e=>e.name==='ReviewParseError' && e.code==='transport' && !e.message.includes('PRIVATE_PROVIDER_SENTINEL'));
  assert.equal(calls,2);
});
