import { it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { registerFileTools } from './files.js';

afterEach(() => vi.unstubAllEnvs());
function fixture(data = 'approved bytes') {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'phunbot-upload-'));
 const localPath=path.join(root,'artifact.txt');fs.writeFileSync(localPath,data);
 vi.stubEnv('AMP_MCP_UPLOAD_ROOTS',root);
 const handlers=new Map<string,any>();
 const server={registerTool:(name:string,_definition:any,handler:any)=>handlers.set(name,handler)} as any;
 const write=vi.fn().mockResolvedValue({Status:true});
 const inst={FileManagerPlugin:{WriteFileChunk:write,CalculateFileMD5Sum:vi.fn().mockResolvedValue({Status:true,Result:createHash('md5').update(data).digest('hex')})}};
 const amp={withInstance:async(_id:string,fn:any)=>fn(inst)} as any;
 const log={child:()=>({info(){},error(){}})} as any;
 registerFileTools(server,amp,log,true);
 return {localPath,write,handlers,handler:handlers.get('amp_upload_file')};
}
it('rejects bytes that differ from the exact owner-approved SHA256 before any remote write',async()=>{
 const f=fixture();
 await expect(f.handler({instanceId:'disposable',localPath:f.localPath,remotePath:'validation/artifact.txt',expectedSha256:'0'.repeat(64)})).rejects.toThrow(/SHA256|approved/i);
 expect(f.write).not.toHaveBeenCalled();
});
it('uploads the approved immutable byte buffer and reports its SHA256 plus fresh server checksum',async()=>{
 const f=fixture();const sha256=createHash('sha256').update('approved bytes').digest('hex');
 const result=await f.handler({instanceId:'disposable',localPath:f.localPath,remotePath:'validation/artifact.txt',expectedSha256:sha256});
 expect(JSON.parse(result.content[0].text)).toMatchObject({uploaded:true,sha256,effectVerified:true});
 expect(f.write).toHaveBeenCalledOnce();
});
it('empty-file uploads must fail before making a remote claim',async()=>{
 const f=fixture('');await expect(f.handler({instanceId:'disposable',localPath:f.localPath,remotePath:'validation/empty.txt',expectedSha256:createHash('sha256').update('').digest('hex')})).rejects.toThrow(/empty|zero/i);expect(f.write).not.toHaveBeenCalled();
});
it('uploads fail closed when AMP_MCP_UPLOAD_ROOTS is unset',async()=>{
 const f=fixture(); vi.unstubAllEnvs();
 await expect(f.handler({instanceId:'disposable',localPath:f.localPath,remotePath:'validation/artifact.txt',expectedSha256:createHash('sha256').update('approved bytes').digest('hex')})).rejects.toThrow(/outside approved roots|none configured/i);
 expect(f.write).not.toHaveBeenCalled();
});
it('direct file handlers reject traversal without relying on the dispatcher',async()=>{
 const f=fixture();
 for(const name of ['amp_rename_file','amp_create_directory','amp_create_archive','amp_copy_file','amp_trash_file']) {
  for(const path of ['../escape','/absolute','bad\\path','bad%2fpath']) await expect(f.handlers.get(name)({instanceId:'disposable',path,newFilename:'safe',targetDirectory:'safe'})).rejects.toThrow(/path|confined|relative/i);
 }
 await expect(f.handler({instanceId:'disposable',localPath:f.localPath,remotePath:'../escape',expectedSha256:createHash('sha256').update('approved bytes').digest('hex')})).rejects.toThrow(/path|confined|relative/i);expect(f.write).not.toHaveBeenCalled();
});
