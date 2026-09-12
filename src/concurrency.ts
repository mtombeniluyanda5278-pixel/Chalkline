import {randomUUID} from 'node:crypto';
import {redis,opaqueIdentity} from './rateLimit.js';
import {config} from './config.js';
import {failure} from './http.js';
export async function transferLease(kind:'upload'|'download',userId:string){
 const token=randomUUID(),keys=[`active:${kind}:global`,`active:${kind}:${opaqueIdentity(userId)}`];
 const max=kind==='upload'?[config.MAX_UPLOADS_GLOBAL,config.MAX_UPLOADS_PER_USER]:[config.MAX_DOWNLOADS_GLOBAL,config.MAX_DOWNLOADS_PER_USER];
 const acquired=await redis.eval("for i=1,2 do redis.call('ZREMRANGEBYSCORE',KEYS[i],'-inf',ARGV[1]); if redis.call('ZCARD',KEYS[i])>=tonumber(ARGV[i+2]) then return 0 end end; for i=1,2 do redis.call('ZADD',KEYS[i],ARGV[2],ARGV[5]);redis.call('EXPIRE',KEYS[i],180) end;return 1",2,...keys,Date.now(),Date.now()+120000,...max,token);
 if(acquired!==1)throw Object.assign(failure(429,'Too many active transfers. Retry shortly.'),{retryAfter:5});
 return async()=>{await redis.multi().zrem(keys[0]!,token).zrem(keys[1]!,token).exec();};
}
