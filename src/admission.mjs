export class Admissions {
 constructor(){this.pending=new Set();}
 assertIdle(id,inFlight,runtimes){if(this.pending.has(id)||inFlight.has(id)||runtimes.get(id)?.busy)throw Error('Conversation is initializing or executing');}
 reserve(row){if(this.pending.has(row.id))throw Error('Conversation request is already initializing');this.pending.add(row.id);const epoch=row.epoch||0;row.cancelRequested=false;return {assertCurrent:()=>{if((row.epoch||0)!==epoch||row.cancelRequested)throw Error('Request cancelled before dispatch');},release:()=>this.pending.delete(row.id)};}
}
