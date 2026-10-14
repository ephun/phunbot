import fs from 'node:fs';
const root=process.env.PHUNBOT_ROOT||'/data';
try {
 const {start}=await import('./app.mjs');
 const server=await start();console.log('phunbot listening',server.address());
 try{const result=await server.resumeGoals();console.log('startup recovery',JSON.stringify(result));}catch(e){console.error('startup recovery deferred',e.message);}
 process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
} catch(error) {
 fs.mkdirSync(root+'/state',{recursive:true});fs.writeFileSync(root+'/state/startup-error.json',JSON.stringify({at:new Date().toISOString(),name:error.name,code:error.code,message:error.message,stack:error.stack},null,2),{mode:0o600});
 throw error;
}
