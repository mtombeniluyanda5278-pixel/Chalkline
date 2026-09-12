import { config } from './config.js';
import { failure } from './http.js';
import { redis, opaqueIdentity } from './rateLimit.js';
export async function verifyBot(token: string|undefined, action: string) {
 if(config.BOT_PROTECTION_PROVIDER==='disabled') throw failure(503,'Human verification is temporarily unavailable.');
 if(!token) throw Object.assign(failure(403,'Complete human verification to continue.'),{code:'CAPTCHA_REQUIRED'});
 if(config.BOT_PROTECTION_PROVIDER==='mock') {
  if(token!=='mock-human') throw failure(403,'Human verification failed.');
  return;
 }
 try {
  const endpoint=config.BOT_PROTECTION_PROVIDER==='turnstile'?'https://challenges.cloudflare.com/turnstile/v0/siteverify':'https://api.hcaptcha.com/siteverify';
  const response=await fetch(endpoint,{method:'POST',redirect:'error',body:new URLSearchParams({secret:config.BOT_PROTECTION_SECRET_KEY!,response:token,sitekey:config.BOT_PROTECTION_SITE_KEY!}),signal:AbortSignal.timeout(8000)});
  const result=await response.json() as {success:boolean;hostname:string;action?:string};
  if(!response.ok || !result.success || result.hostname!==new URL(config.WEBAUTHN_ORIGIN).hostname || (config.BOT_PROTECTION_PROVIDER==='turnstile' && result.action!==action)) throw new Error('verification');
 } catch {throw failure(403,'Human verification failed. Please retry.');}
}
export async function failedLogin(email:string,ip:string) {
 for(const identity of [email,`ip:${ip}`,`${email}:${ip}`]) await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],900) end; return n",1,`fail:${opaqueIdentity(identity)}`);
}
export async function loginProtection(email:string,ip:string,token?:string) {
 const keys=[email,`ip:${ip}`,`${email}:${ip}`].map(x=>`fail:${opaqueIdentity(x)}`);
 const counts=(await redis.mget(...keys)).map(Number);
 if(counts[1]!>=30 || counts[2]!>=10) {
  const ttl=await redis.ttl(keys[counts[1]!>=30?1:2]!);
  throw Object.assign(failure(429,'Too many attempts. Try again later.'),{retryAfter:Math.max(1,ttl)});
 }
 if(counts[0]!>=5) await verifyBot(token,'login');
}
