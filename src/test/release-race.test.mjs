import {test} from 'node:test';import assert from 'node:assert/strict';import {GoalQueue} from '../goal-queue.mjs';
test('lease release retries a concurrent authorization CAS without retaining a dead executor lease',async()=>{
 let row={id:'g',status:'NEEDS-ACTION',revision:1,etag:'1',lease:{token:'owned'},execution:{state:'waiting_permission'}};let writes=0;
 const nc={get:async()=>structuredClone(row),put:async(next,etag)=>{if(++writes===1){row={...row,etag:'2',authorizations:[{id:'a',state:'approved'}]};throw Error('Nextcloud 412 controlled');}assert.equal(etag,row.etag);row={...next,etag:'3'};return row;}};
 const result=await new GoalQueue(nc).release('g','owned',{state:'queued',nextRunAt:0});assert.equal(result.lease,null);assert.equal(result.authorizations[0].state,'approved');assert.equal(writes,2);
});
