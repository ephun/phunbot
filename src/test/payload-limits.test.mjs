import {test} from 'node:test';import assert from 'node:assert/strict';import {limitPayload} from '../payload-limits.mjs';
test('Responses requests use max_output_tokens without adding chat-only fields',()=>{const p=limitPayload({input:[],max_output_tokens:9000},2048);assert.equal(p.max_output_tokens,2048);assert.equal(p.max_tokens,undefined);const q=limitPayload({input:[]},2048);assert.equal(q.max_output_tokens,2048);});
test('explicit native non-thinking mode is opt-in and never leaks chat template flags into Responses',()=>{
 assert.equal(limitPayload({messages:[]},2048,{enableThinking:false}).chat_template_kwargs.enable_thinking,false);
 assert.equal(limitPayload({messages:[]},2048).chat_template_kwargs,undefined);
 assert.equal(limitPayload({input:[]},2048,{enableThinking:false}).chat_template_kwargs,undefined);
});
test('native provider requests enforce output budgets without raising smaller limits or mixing token parameter styles',()=>{assert.equal(limitPayload({max_tokens:32768},2048).max_tokens,2048);assert.equal(limitPayload({max_tokens:1000},2048).max_tokens,1000);const p=limitPayload({max_completion_tokens:32768},2048);assert.equal(p.max_completion_tokens,2048);assert.equal(p.max_tokens,undefined);});
