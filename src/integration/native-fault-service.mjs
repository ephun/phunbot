import path from 'node:path';
import fs from 'node:fs';
const root=process.env.VALIDATION_ROOT;if(!(typeof root==='string' && path.basename(root).startsWith('phunbot-native-fault-')))throw Error('Isolated fixture root required');
const rpc=async(op,args)=>{const r=await fetch(process.env.FIXTURE_URL+'/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,args})});const d=await r.json();if(!r.ok)throw Error(d.error);return d;};
const nc={get:(id)=>rpc('get',[id]),list:()=>rpc('list',[]),put:(value,etag)=>rpc('put',[value,etag])};
const {start}=await import('../app.mjs');
const server=await start({root,port:0,token:'native-fault-fixture',ncClient:nc});
console.log(JSON.stringify({port:server.address().port,pid:process.pid}));
await server.resumeGoals();process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
