import crypto from 'node:crypto';
const ampReads=new Set(['amp_list_instances','amp_get_instance_status','amp_get_active_users','amp_get_host_status','amp_get_running_tasks','amp_get_update_info','amp_list_backups','amp_file_md5']);
const unraidReads={system:new Set(['overview','array','network','metrics','network_metrics','services','online','server','server_time','timezones','network_interfaces']),disk:new Set(['shares','disks','disk_details','log_files','logs']),vm:new Set(['list']),health:new Set(['test_connection']),help:new Set([''])};
function canonical(x){if(Array.isArray(x))return x.map(canonical);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));return x;}
const effectHash=(name,args)=>crypto.createHash('sha256').update(JSON.stringify(canonical([name,args]))).digest('hex');
export function classify(name,args){
 if(['read_mcp_resource','list_mcp_resources','list_mcp_resource_templates'].includes(name))return {mode:'deny',reason:'Infrastructure resource passthrough is not enabled; use scoped typed tools.'};
 if(!name.startsWith('mcp__'))return {mode:'read'};
 if(name.startsWith('mcp__phunbot__')){const op=name.slice('mcp__phunbot__'.length);return {mode:['memory_search','memory_read','memory_observe','memory_link','nextcloud_goals','n8n_workflows','web_fetch','service_probe'].includes(op)?'read':'deny',reason:'Unregistered capability is not authorized'};}
 if(name.startsWith('mcp__amp__')){const op=name.slice('mcp__amp__'.length);if(ampReads.has(op))return {mode:'read'};if(op==='amp_get_config'&&!/password|passwd|secret|token|key|license|credential|auth/i.test(args.node||''))return {mode:'read'};if(op==='amp_get_config')return {mode:'deny',reason:'Credential-bearing AMP settings are not available to the agent'};return {mode:'approval'};}
 if(name==='mcp__unraid__unraid'){
  if(args.action==='docker')return {mode:'deny',reason:'Docker control-plane access is not enabled. Its private network and mandatory cleanup policy require operator verification before enablement.'};
  if(['key','oidc','connect','onboarding'].includes(args.action)||args.action==='setting'&&args.subaction==='update_ssh')return {mode:'deny',reason:'Credential, authentication, SSH and public-ingress changes require an operator outside the agent'};
  if(unraidReads[args.action]?.has(args.subaction||''))return {mode:'read'};
  return {mode:'approval'};
 }
 return {mode:'deny',reason:'Unregistered capability is not authorized'};
}
export class Permissions {
 constructor(nc,controller){this.nc=nc;this.controller=controller;this.locks=new Map();}
 async lock(id,fn){if(this.controller.lock)return this.controller.lock(id,fn);const prior=this.locks.get(id)||Promise.resolve();const job=prior.catch(()=>{}).then(fn);this.locks.set(id,job);try{return await job;}finally{if(this.locks.get(id)===job)this.locks.delete(id);}}
 async check(name,args,goalId){
  const policy=classify(name,args);
  if(policy.mode==='read')return {allowed:true};
  if(policy.mode==='deny'){if(goalId)this.controller.record(goalId,name,args,{policy:'safety_denial',reason:policy.reason},true);return {allowed:false,reason:'Safety: '+policy.reason};}
  if(!goalId)return {allowed:false,reason:'Authorization requires an active Nextcloud goal'};
  return this.lock(goalId,async()=>{
   const goal=await this.nc.get(goalId);if(goal.status!=='NEEDS-ACTION')return {allowed:false,reason:'Goal is not open'};
   if(name.endsWith('amp_take_backup')&&!/\bbackup\b/i.test(goal.request))return {allowed:false,reason:'Full AMP backups require an explicit backup request; use a narrower reversible alternative'};
   const hash=effectHash(name,args),items=goal.authorizations||[];if(items.some(x=>x.hash===hash&&x.state==='denied'))return {allowed:false,reason:'Owner explicitly denied this exact operation; choose a different authorized approach or preserve the goal'};
   const approved=items.find(x=>x.hash===hash&&x.state==='approved'&&Date.now()-Date.parse(x.approvedAt)<3600000);
   if(approved){approved.state='consumed';approved.consumedAt=new Date().toISOString();await this.nc.put({...goal,authorizations:items},goal.etag);return {allowed:true,authorizationId:approved.id};}
   let pending=items.find(x=>x.hash===hash&&x.state==='pending');
   if(!pending){if(items.filter(x=>x.state==='pending').length>=5)return {allowed:false,reason:'Authorization queue is full; reconsider the plan'};pending={id:crypto.randomUUID(),tool:name,args,hash,state:'pending',requestedAt:new Date().toISOString()};items.push(pending);await this.nc.put({...goal,authorizations:items},goal.etag);}
   this.controller.record(goalId,name,args,{policy:'owner_authorization',requestId:pending.id,reason:'Owner authorization is required for this exact consequential operation'},true);
   return {allowed:false,requestId:pending.id,reason:'Owner authorization required. Request '+pending.id+' is pending in the browser. Continue safe diagnostics; preserve the goal if no other meaningful work remains.'};
  });
 }
 async decide(goalId,requestId,approve){return this.lock(goalId,async()=>{const goal=await this.nc.get(goalId);if(goal.status!=='NEEDS-ACTION')throw Error('Goal is not open');const items=goal.authorizations||[],item=items.find(x=>x.id===requestId);if(!item||item.state!=='pending')throw Error('Authorization request is not pending');item.state=approve?'approved':'denied';if(approve)item.approvedAt=new Date().toISOString();const updated={...goal,authorizations:items};if(goal.blocker?.kind==='authorization')delete updated.blocker;return this.nc.put(updated,goal.etag);});}
}
