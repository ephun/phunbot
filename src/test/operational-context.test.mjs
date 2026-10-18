import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
test('review evidence includes current-revision memory tool reads, excludes stale and failed reads',async()=>{
 const {supportingMemoryEvidence}=await import('../operational-context.mjs');
 const controller={checkpoint:()=>({evidence:[{id:'good',revision:2,tool:'mcp__phunbot__memory_get'},{id:'old',revision:1,tool:'mcp__phunbot__memory_get'},{id:'bad',revision:2,error:true,tool:'mcp__phunbot__memory_get'}]}),loadEvidenceResult:()=>({text:'Owner likes tea.'})};
 const evidence=supportingMemoryEvidence(controller,{id:'g',revision:2});assert.equal(evidence.length,1);assert.equal(evidence[0].evidenceId,'good');assert.match(evidence[0].excerpt,/tea/);
});
test('memory tool evidence preserves actual note identity and hashes instead of wrapping opaque tool JSON',async()=>{
 const {supportingMemoryEvidence}=await import('../operational-context.mjs');
 const controller={checkpoint:()=>({evidence:[{id:'read1',revision:1,tool:'mcp__phunbot__memory_read'}]}),loadEvidenceResult:()=>({content:[{type:'text',text:JSON.stringify({id:'owner-facts',markdown:'# Owner\nLikes tea.'})}]})};
 const [note]=supportingMemoryEvidence(controller,{id:'g',revision:1});assert.equal(note.id,'owner-facts');assert.equal(note.excerpt,'# Owner\nLikes tea.');assert.equal(note.evidenceId,'read1');assert.match(note.version,/^[a-f0-9]{64}$/);
});
test('essential planning knowledge is deterministic, versioned, bounded, and cannot invent tools',async()=>{
 assert.ok(fs.existsSync(new URL('../operational-context.mjs',import.meta.url)),'operational context loader is required');
 const {loadOperationalContext}=await import('../operational-context.mjs');const reads=[];
 const memory={get:id=>{reads.push(id);return '# '+id+'\nKnowledge\n## See also\nignored';},search:()=>[{id:'facts',text:'User likes tea.'}]};
 const c=loadOperationalContext(memory,{planning:{identityNote:'phunbot-identity',procedureNote:'goal-planning-procedure'}},[{name:'read',description:'Read files'},{name:'bash',description:'Not available'}],'question');
 assert.deepEqual(reads,['phunbot-identity','goal-planning-procedure']);assert.equal(c.identity.id,'phunbot-identity');assert.ok(c.identity.version);assert.ok(!c.identity.excerpt.includes('ignored'));assert.ok(!c.capabilities.some(t=>t.name==='bash'));assert.equal(c.memoryEvidence[0].id,'facts');
 assert.throws(()=>loadOperationalContext({...memory,get:()=>{throw Error('missing');}},{planning:{procedureNote:'required'}},[],''),/Essential planning knowledge unavailable/);
});
