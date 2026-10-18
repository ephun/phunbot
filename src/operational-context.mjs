import crypto from 'node:crypto';
import {redactCredentialText} from './privacy.mjs';
function excerpt(id,text,limit=2200){const clean=String(text).split(/\n## (?:See also|Inferred relationships)/)[0];return {id,version:crypto.createHash('sha256').update(String(text)).digest('hex'),excerpt:redactCredentialText(clean).slice(0,limit)};}
/** Stable note IDs bootstrap knowledge; code still owns permissions and contracts. */
export function loadOperationalContext(memory,policy,tools=[],query=''){
 const essential=id=>{if(!id)return undefined;try{return excerpt(id,memory.get(id),6000);}catch{const e=new Error('Essential planning knowledge unavailable: '+id);e.code='planning_context_unavailable';throw e;}};
 const identity=essential(policy.planning?.identityNote),procedure=essential(policy.planning?.procedureNote);
 const memoryEvidence=(memory.search(query)||[]).slice(0,5).map(n=>excerpt(n.id,n.text));
 const capabilities=tools.filter(t=>!['bash','edit'].includes(t.name)).slice(0,160).map(t=>({name:t.name,description:String(t.description||'').slice(0,400)}));
 return {identity,procedure,capabilities,memoryEvidence,constraints:{permissions:'Existing permission gates remain authoritative; capability presence does not grant authorization.',workspace:'Only registered capabilities are available; no shell or host commands may be assumed.'}};
}
export function projectMemoryNotes(notes=[]){return notes.slice(0,5).map(n=>excerpt(n.id,n.text));}
export function supportingMemoryEvidence(controller,goal){
 const events=controller.checkpoint(goal.id).evidence.filter(e=>e.revision===(goal.revision||1)&&!e.error&&(e.tool==='memory_context'||/^mcp__phunbot__memory_(?:get|search|read)$/.test(e.tool))).slice(-12);
 const notes=new Map();for(const e of events){const result=controller.loadEvidenceResult(goal.id,e.id);
  if(e.tool==='memory_context'){for(const n of result?.notes||[])if(n.id&&typeof n.excerpt==='string')notes.set(n.id+'@'+n.version,{...n,evidenceId:e.id});}
  else {
   let value=result;
   if(Array.isArray(result?.content)) {
    const text=result.content.filter(p=>p.type==='text').map(p=>p.text).join('\n');
    try{value=JSON.parse(text);}catch{value={text};}
   }
   const rows=Array.isArray(value)?value:[value];
   for(const n of rows.slice(0,5)) {
    const text=n?.markdown??n?.text;
    if(typeof text!=='string')continue;
    const item={...excerpt(n.id || e.tool,text,2200),evidenceId:e.id,source:'Recorded memory tool read'};
    notes.set(item.id+'@'+item.version,item);
   }
  }
 }
 return [...notes.values()].slice(-12);
}
