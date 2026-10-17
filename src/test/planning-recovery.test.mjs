import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planGoal} from '../planning.mjs';
import {parsePlanningDecision,planningProperties} from '../planning-decision.mjs';
const goal={id:'isolated',request:'What do you know about me?',title:'What do you know about me?',revision:1,requestHistory:[{text:'What do you know about me?'}]};
const policy={provider:'fixture',roles:{planner:'deep'}};
const valid=()=>({title:'Answer the question',description:'Answer using only available context and relevant memory; state unknowns.',criteria:[{title:'Give a grounded substantive answer',verifier:{kind:'answer_quality',path:'',text:''}}],subgoals:[],changes:['Initial plan'],execution:'continue'});
const response=(value,stopReason='stop')=>({stopReason,content:[{type:'text',text:JSON.stringify(value)}]});
test('planner repairs observed alternate goal/action envelope through a changed deep request',async()=>{
 const calls=[];const runtime={getModel:()=>({id:'deep'}),completeSimple:async(m,c,o)=>{calls.push(c);assert.equal(o.onPayload({input:[]}).text.format.type,'json_schema');return calls.length===1?response({goal:{title:'wrong envelope'},criteria:valid().criteria,subgoals:[],action:'continue'}):response(valid());}};
 const decision=await planGoal(runtime,policy,goal,[],[],[]);
 assert.equal(decision.criteria.length,1);assert.equal(calls.length,2);assert.notDeepEqual(calls[0],calls[1]);assert.match(JSON.stringify(calls[1]),/title|schema/);
});
test('planner exhausts at two invalid decisions with safe field diagnostics and no raw output',async()=>{
 let calls=0;const runtime={getModel:()=>({id:'deep'}),completeSimple:async()=>{calls++;return response({goal:{description:'PRIVATE_SENTINEL'},action:'continue'});}};
 await assert.rejects(planGoal(runtime,policy,goal,[],[],[]),e=>e.name==='PlanningDecisionError' && e.diagnostics?.attempts===2 && !JSON.stringify(e).includes('PRIVATE_SENTINEL') && e.diagnostics.issues.some(x=>x.path==='title'));
 assert.equal(calls,2);
});
test('planner retries one transient transport failure without treating failure as a plan',async()=>{
 let calls=0;const runtime={getModel:()=>({id:'deep'}),completeSimple:async()=>{calls++;return calls===1?response({},'error'):response(valid());}};
 const decision=await planGoal(runtime,policy,goal,[],[],[]);
 assert.equal(decision.title,'Answer the question');assert.equal(calls,2);
});
test('planner rejects schema drift, truncation, invalid criteria and subgoal graphs without coercion',()=>{
 const cases=[
  [v=>{v.title=' ';},'title','string_bounds'],
  [v=>{v.criteria=[];},'criteria','count'],
  [v=>{delete v.criteria[0].verifier.text;},'criteria[0].verifier.text','required'],
  [v=>{v.criteria[0].verifier.path='ignored-but-not-empty';},'criteria[0].verifier','verifier_fields'],
  [v=>{v.execution='complete';},'execution','enum'],
  [v=>{v.extra='PRIVATE_SENTINEL';},'','unexpected_field'],
  [v=>{v.subgoals=[{id:'a',title:'A',parentId:'missing'}];},'subgoals[0].parentId','unknown_parent'],
  [v=>{v.subgoals=[{id:'a',title:'A',parentId:'a'}];},'subgoals[0].parentId','cycle']
 ];
 for(const [mutate,path,code]of cases){const v=valid();mutate(v);assert.throws(()=>parsePlanningDecision(response(v)),e=>e.diagnostics.issues.some(i=>i.path===path&&i.code===code)&&!JSON.stringify(e).includes('PRIVATE_SENTINEL'));}
 assert.throws(()=>parsePlanningDecision(response(valid(),'length')),e=>e.diagnostics.issues[0].code==='stop_reason');
 assert.throws(()=>parsePlanningDecision({content:[{type:'text',text:'{"title":'}]}),e=>e.diagnostics.issues[0].code==='malformed');
 assert.equal(planningProperties.title.maxLength,300);
});
