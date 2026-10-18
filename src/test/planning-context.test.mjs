import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planGoal} from '../planning.mjs';
test('follow-up planning uses visible conversation rather than runtime prompts and tool schemas',async()=>{
 const history=[
  {type:'custom_message',customType:'conversation-projection-v1',content:'{}'},
  {type:'message',message:{role:'system',content:'PRIVATE_RUNTIME_PROMPT_SENTINEL',toolsAdded:[{name:'PRIVATE_TOOL_SCHEMA_SENTINEL'}]}},
  {type:'message',message:{role:'user',content:[{type:'text',text:'Hi.'}]}},
  {type:'custom_message',customType:'memory-retrieval',content:'PRIVATE_INTERNAL_MEMORY_SNAPSHOT'},
  {type:'message',message:{role:'assistant',content:[{type:'thinking',thinking:'PRIVATE_REASONING_SENTINEL'},{type:'toolCall',name:'goal_state',arguments:{}}]}},
  {type:'custom',customType:'conversation-output',data:{role:'assistant',kind:'answer',content:'Hi! 👋'}},
  {type:'message',message:{role:'user',content:[{type:'text',text:'Huh?'},{type:'image',mimeType:'image/png',data:'PRIVATE_IMAGE_BYTES'}]}}
 ];
 const evidence=[{id:'real-evidence',tool:'read',result:'Useful observed result'}];let seen;
 const plan={title:'Clarify greeting',description:'Answer the follow-up',criteria:[{title:'Clarify the greeting',verifier:{kind:'answer_quality',path:'',text:''}}],subgoals:[],changes:['Updated context'],execution:'continue'};
 const runtime={getModel:()=>({id:'deep'}),completeSimple:async(_m,c)=>{seen=JSON.parse(c.messages[0].content[0].text);return {stopReason:'stop',content:[{type:'text',text:JSON.stringify(plan)}]};}};
 await planGoal(runtime,{provider:'fixture',roles:{planner:'deep'}},{id:'g',requestHistory:[{text:'Hi.'},{text:'Huh?'}]},history,[],evidence);
 const serialized=JSON.stringify(seen.conversationHistory);
 assert.ok(!serialized.includes('PRIVATE_'));
 assert.equal(seen.conversationHistory.length,3);
 assert.equal(seen.conversationHistory[1].content,'Hi! 👋');
 assert.deepEqual(seen.conversationHistory[2].content[1],{type:'image_metadata',mimeType:'image/png'});
 assert.deepEqual(seen.executionEvidence,{omitted:0,events:[{id:'real-evidence',tool:'read',error:false,resultPreview:'Useful observed result'}]});
 assert.deepEqual(seen.goal.requestHistory.map(r=>r.text),['Hi.','Huh?']);
});
