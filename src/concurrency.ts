import { randomUUID } from 'node:crypto';
import { redis, opaqueIdentity } from './rateLimit.js';
import { config } from './config.js';
import { failure } from './http.js';
export type ConcurrencyLease = (() => Promise<void>) & { signal: AbortSignal };
const acquire = `
local time=redis.call('TIME'); local now=time[1]*1000+math.floor(time[2]/1000)
for i=1,#KEYS do redis.call('ZREMRANGEBYSCORE',KEYS[i],'-inf',now); if redis.call('ZCARD',KEYS[i])>=tonumber(ARGV[i+2]) then return 0 end end
for i=1,#KEYS do redis.call('ZADD',KEYS[i],now+tonumber(ARGV[1]),ARGV[2]);redis.call('PEXPIRE',KEYS[i],ARGV[1]) end
return 1`;
const renew = `
local time=redis.call('TIME'); local now=time[1]*1000+math.floor(time[2]/1000)
for i=1,#KEYS do local expiry=redis.call('ZSCORE',KEYS[i],ARGV[2]);if not expiry or tonumber(expiry)<=now then return 0 end end
for i=1,#KEYS do redis.call('ZADD',KEYS[i],now+tonumber(ARGV[1]),ARGV[2]);redis.call('PEXPIRE',KEYS[i],ARGV[1]) end
return 1`;
export async function concurrencyLease(limits: { key: string; max: number }[], timing = { ttlMs: 120000, renewMs: 30000 }): Promise<ConcurrencyLease | null> {
  if (redis.status !== 'ready') throw failure(503, 'Transfer capacity is temporarily unavailable.');
  if (!limits.length || timing.renewMs >= timing.ttlMs / 2) throw new Error('Invalid lease configuration');
  const token = randomUUID(), keys = limits.map(limit => limit.key), controller = new AbortController();
  const started = Date.now();
  if (await redis.eval(acquire, keys.length, ...keys, timing.ttlMs, token, ...limits.map(limit => limit.max)) !== 1) return null;
  let released = false, refreshing = false;
  const lost = () => { clearInterval(interval); clearTimeout(expiry); controller.abort(new Error('Concurrency lease lost')); };
  // If Redis stalls, stop the transfer before the last confirmed lease can expire.
  let expiry = setTimeout(lost, Math.max(1, timing.ttlMs - (Date.now() - started) - timing.renewMs));
  const interval = setInterval(() => {
    if (released || refreshing || controller.signal.aborted) return;
    refreshing = true;
    const began = Date.now();
    void redis.eval(renew, keys.length, ...keys, timing.ttlMs, token).then(result => {
      if (released || controller.signal.aborted) return;
      if (result !== 1) return lost();
      clearTimeout(expiry);
      expiry = setTimeout(lost, Math.max(1, timing.ttlMs - (Date.now() - began) - timing.renewMs));
      expiry.unref();
    }).catch(lost).finally(() => { refreshing = false; });
  }, timing.renewMs);
  expiry.unref(); interval.unref();
  const release = async () => {
    if (released) return;
    released = true; clearInterval(interval); clearTimeout(expiry);
    // Renew never recreates a missing token, so an in-flight renewal cannot resurrect a released slot.
    await redis.eval("for i=1,#KEYS do redis.call('ZREM',KEYS[i],ARGV[1]) end;return 1", keys.length, ...keys, token).catch(() => {});
  };
  return Object.assign(release, { signal: controller.signal });
}
export async function transferLease(kind: 'upload' | 'download', userId: string) {
  const max = kind === 'upload' ? [config.MAX_UPLOADS_GLOBAL, config.MAX_UPLOADS_PER_USER] : [config.MAX_DOWNLOADS_GLOBAL, config.MAX_DOWNLOADS_PER_USER];
  const lease = await concurrencyLease([{ key: `active:${kind}:global`, max: max[0]! }, { key: `active:${kind}:${opaqueIdentity(userId)}`, max: max[1]! }]);
  if (!lease) throw Object.assign(failure(429, 'Too many active transfers. Retry shortly.'), { retryAfter: 5 });
  return lease;
}
export function scanLease() { return concurrencyLease([{ key: 'active:scan:global', max: config.MAX_SCANS_GLOBAL }]); }
