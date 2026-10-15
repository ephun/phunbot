import {it,expect,vi} from 'vitest';
import {registerInstanceTools} from './instances.js';
it('wrapper restart resolves the exact authorized UUID to the authoritative AMP name',async()=>{
 const handlers=new Map<string,any>(),restart=vi.fn().mockResolvedValue({Status:true});
 const amp={listInstances:async()=>[{InstanceID:'uuid-one',InstanceName:'NAME_ONE'},{InstanceID:'uuid-two',InstanceName:'NAME_TWO'}],withController:async(fn:any)=>fn({ADSModule:{RestartInstance:restart}})} as any;
 registerInstanceTools({registerTool:(name:string,_def:any,fn:any)=>handlers.set(name,fn)} as any,amp,{child:()=>({info(){},error(){}})} as any,true);
 await handlers.get('amp_force_restart_wrapper')({instanceId:'uuid-one'});
 expect(restart).toHaveBeenCalledWith('NAME_ONE');
 await expect(handlers.get('amp_force_restart_wrapper')({instanceId:'NAME_TWO'})).rejects.toThrow(/not found/);
 expect(restart).toHaveBeenCalledOnce();
});
