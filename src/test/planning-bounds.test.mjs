import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planGoal} from '../planning.mjs';
const decision={title:'Answer',description:'Original outcome',criteria:[{title:'Answer delivered',verifier:{kind:'answer_quality',path:'',text:''}}],subgoals:[],changes:[],execution:'continue'};
test('planner evidence is bounded and excludes private assistant diagnostics while retaining observation provenance',async()=>{
 let payload;
 const rt={getModel:()=>({id:'fast'}),completeSimple:async(m,c)=>{payload=JSON.parse(c.messages[0].content[0].text);return {stopReason:'stop',content:[{type:'text',text:JSON.stringify(decision)}]};}};
 const evidence=[{id:'private',tool:'assistant_output',result:'PRIVATE_REASONING'},...Array.from({length:100},(_,i)=>({id:'obs-'+i,revision:1,tool:'read',result:'x'.repeat(10000)}))];
 await planGoal(rt,{provider:'fixture',roles:{planner:'fast'}},{id:'g',revision:1,request:'Original outcome',requestHistory:[{text:'Original outcome'}]},[],[],evidence);
 assert.ok(JSON.stringify(payload.executionEvidence).length<100000);
 assert.doesNotMatch(JSON.stringify(payload),/PRIVATE_REASONING/);
 assert.ok(payload.executionEvidence.events.some(e=>e.id==='obs-99'&&e.revision===1));
 assert.ok(payload.executionEvidence.omitted>0);
 assert.equal(payload.goal.request,'Original outcome');
});
