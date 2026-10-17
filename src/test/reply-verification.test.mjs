import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {Controller} from '../controller.mjs';
class Tasks {
  data=new Map();
  async put(d){const row=structuredClone({...d,etag:'"'+crypto.randomUUID()+'"'});this.data.set(d.id,row);return row;}
  async get(id){return structuredClone(this.data.get(id));}
  async list(){return [...this.data.values()].map(x=>structuredClone(x));}
}
async function setup(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'phunbot-reply-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const nc=new Tasks(), c=new Controller(root,nc);
  const g=await c.create('Hi.','isolated','fleet-fast');
  const [criterion]=await c.plan(g.id,[{title:'Friendly greeting',verifier:{kind:'answer_quality'}}]);
  c.save({...c.checkpoint(g.id),currentRevision:1});
  return {root,nc,c,g,criterion};
}
function publish(c,id,text='Hi! How can I help?',revision=1){
  const outputKey=crypto.createHash('sha256').update(JSON.stringify([id,revision,'answer',text])).digest('hex');
  const cp=c.checkpoint(id); cp.userVisibleOutputs ||= [];
  cp.userVisibleOutputs.push({outputKey,revision,kind:'answer',text});c.save(cp);
  return c.record(id,'reply',{kind:'answer',text},[{type:'text',text:JSON.stringify({kind:'answer',text,outputKey,published:true})}],false);
}
test('prior-revision published reply cannot verify a follow-up criterion',async t=>{
  const {c,nc,g,criterion}=await setup(t);publish(c,g.id);
  await nc.put({...await nc.get(g.id),revision:2,requestHistory:[{text:'Hi.'},{text:'Huh?'}]});
  c.save({...c.checkpoint(g.id),currentRevision:2});
  c.answerReviewer=async()=>({pass:true,reason:'Greeting looks friendly'});
  await assert.rejects(c.verify(g.id,criterion.id),/Canonical visible answer required/);
  assert.equal((await nc.get(criterion.id)).status,'NEEDS-ACTION');
});
test('unpublished reply candidate cannot be laundered by a published flag alone',async t=>{
  const {c,nc,g,criterion}=await setup(t);
  c.record(g.id,'reply',{kind:'answer',text:'Hi!'},{kind:'answer',text:'Hi!',published:true,outputKey:'invented'},false);
  await assert.rejects(c.verify(g.id,criterion.id),/Canonical visible answer required/);
  assert.equal((await nc.get(criterion.id)).status,'NEEDS-ACTION');
});
test('settle waits for a canonical answer without recording verifier outage',async t=>{
  const {c,g}=await setup(t);
  const state=await c.settle(g.id);
  assert.equal(state.continue,true);
  assert.notEqual(c.checkpoint(g.id).state,'verifier_unavailable');
});
test('current published reply receives independent full-content review before acceptance',async t=>{
  const {c,nc,g,criterion}=await setup(t);const text='Hi! '+ 'Friendly greeting. '.repeat(210);
  const e=publish(c,g.id,text);let reviewed;
  c.answerReviewer=async(_g,_t,event)=>{reviewed=event;return {pass:true,reason:'Actual greeting is appropriate'};};
  const accepted=await c.verify(g.id,criterion.id);
  assert.equal((await nc.get(criterion.id)).status,'COMPLETED');
  assert.deepEqual(accepted.evidence.evidenceIds,[e.id]);
  const value=typeof reviewed.result==='string'?JSON.parse(reviewed.result):reviewed.result;
  const reply=Array.isArray(value)?JSON.parse(value[0].text):value;
  assert.equal(reply.text,text);
});
