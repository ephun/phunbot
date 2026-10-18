import {test} from 'node:test';import assert from 'node:assert/strict';import {GoalQueue} from '../goal-queue.mjs';
test('deployment recovery hold excludes historical revisions without changing goal state; new instructions release only their revised goal',async()=>{
 const rows=new Map();let v=0;const nc={get:async id=>{if(!rows.has(id))throw Error('404');return structuredClone(rows.get(id));},list:async()=>structuredClone([...rows.values()]),put:async(d,e)=>{const old=rows.get(d.id);if(old?old.etag!==e:Boolean(e))throw Error('412');const x={...structuredClone(d),etag:String(++v)};rows.set(d.id,x);return structuredClone(x);}};
 const q=new GoalQueue(nc);const g=await q.admit({conversationId:'fixture',requestId:'first',text:'Hi.',model:'fast'});const before=await nc.get(g.id);assert.equal(await q.claim(Date.now(),undefined,{[g.id]:1}),null);assert.deepEqual(await nc.get(g.id),before);
 const revised=await q.admit({conversationId:'fixture',requestId:'second',text:'Please answer now.',model:'fast'});assert.equal(revised.revision,2);assert.equal((await q.claim(Date.now(),undefined,{[g.id]:1})).id,g.id);
});
