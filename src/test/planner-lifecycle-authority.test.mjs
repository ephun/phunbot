import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {planGoal} from '../planning.mjs';
import {Controller} from '../controller.mjs';
const plan={title:'Clarify greeting',description:'Explain the greeting in response to Huh?',criteria:[{title:'Answer the clarification',verifier:{kind:'answer_quality',path:'',text:''}}],subgoals:[],changes:['Clarify greeting'],execution:'continue'};
test('an old lease failure does not grant the planner authority to pause an active request',async()=>{
 let calls=0;const rt={getModel:()=>({id:'deep'}),completeSimple:async()=>({stopReason:'stop',content:[{type:'text',text:JSON.stringify({...plan,execution:++calls===1?'pause':'continue'})}]})};
 const result=await planGoal(rt,{provider:'fixture',roles:{planner:'deep'}},{id:'g',paused:false,revision:2,requestHistory:[{text:'Hi.'},{text:'Huh?'}]},[],[],[{tool:'goal_verify',error:true,result:'Execution cancelled or lease expired'}]);
 assert.equal(result.execution,'continue');assert.equal(calls,2);
});
test('controller rejects a new planner-owned pause before modifying accepted criteria',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'phunbot-plan-pause-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const rows=new Map();let writes=0;const nc={put:async d=>{writes++;rows.set(d.id,structuredClone({...d,etag:String(writes)}));return structuredClone(rows.get(d.id));},get:async id=>structuredClone(rows.get(id)),list:async()=>[...rows.values()].map(x=>structuredClone(x))};
 const c=new Controller(root,nc);const g=await c.create('Huh?','isolated','fast');const before=writes;
 await assert.rejects(c.applyPlanning(g.id,{...plan,execution:'pause'},1),/authenticated owner/);
 assert.equal(writes,before);assert.notEqual((await nc.get(g.id)).paused,true);
});
