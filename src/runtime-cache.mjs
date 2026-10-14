export function evictable(runtimes,inFlight){return [...runtimes.entries()].filter(([id,r])=>!r.busy&&!r.maintenance&&!inFlight.has(id)).sort((a,b)=>(a[1].lastUsed||0)-(b[1].lastUsed||0))[0];}
