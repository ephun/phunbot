import {test} from 'node:test';import assert from 'node:assert/strict';import {classify} from '../permissions.mjs';
// Verified against the installed typed MCP dispatch table and live read-only calls.
// array/array is NOT registered; system/array is the valid state query.
test('registered parity and live array diagnostics are read-only without approval',()=>{
 for(const args of [{action:'array',subaction:'parity_status'},{action:'live',subaction:'array_state',collect_for:1,timeout:5},{action:'system',subaction:'array'}])assert.equal(classify('mcp__unraid__unraid',args).mode,'read');
});
test('unsupported alias and array mutations never inherit read-only permission',()=>{
 for(const args of [{action:'array',subaction:'array'},{action:'array',subaction:'parity_start'},{action:'live',subaction:'invented_state'},{action:'array',subaction:'stop_array'}])assert.equal(classify('mcp__unraid__unraid',args).mode,'deny');
});
