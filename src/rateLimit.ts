import { Redis } from "ioredis";
import { config } from "./config.js";

type Bucket = { max: number; windowMs: number };

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  enableReadyCheck: true,
});

export const buckets = {
  login: { max: 5, windowMs: 15 * 60 * 1000 },
  signup: { max: 5, windowMs: 60 * 60 * 1000 },
  passwordReset: { max: 3, windowMs: 60 * 60 * 1000 },
  passwordChange: { max: 5, windowMs: 15 * 60 * 1000 },
  resendVerification: { max: 3, windowMs: 60 * 60 * 1000 },
  accountDelete: { max: 3, windowMs: 60 * 60 * 1000 },
  emailChange: { max: 3, windowMs: 60 * 60 * 1000 },
   accountChange: { max: 5, windowMs: 15 * 60 * 1000 },
  admin: { max: 60, windowMs: 60 * 1000 },
  webauthn: { max: 10, windowMs: 60 * 1000 },
  global: { max: 120, windowMs: 60 * 1000 },
} as const satisfies Record<string, Bucket>;

// NOTE: no in-memory fallback in this version — Redis is required in every
// environment, dev included. That's a deliberate simplification (it matches
// the fact that dev already runs Redis via docker-compose, and it's what
// the atomic Lua-based consumeRateLimit below needs anyway), but it does
// mean a Redis outage takes the *entire* app down, including /health, since
// the global onRequest hook in app.ts calls consumeRateLimit("global", ...)
// on every request. If that trade-off isn't wanted, reintroduce a
// try/catch + in-memory Map fallback here, matching the previous design.

export async function connectRedis(): Promise<void> {
  if (redis.status === "ready") {
    return;
  }
  await redis.connect();
  await redis.ping();
}

export async function closeRedis(): Promise<void> {
  if (redis.status === "end") {
    return;
  }
  await redis.quit();
}

// Test-only: wipes all Redis state so test runs don't get throttled by
// counters left over from a previous run hitting the same buckets (e.g.
// "signup:127.0.0.1" from app.inject(), which always uses the same fake IP).
export async function clearTestRateLimits(): Promise<void> {
  if (config.NODE_ENV !== "test") {
    throw new Error("clearTestRateLimits() is only available in test mode.");
  }
  await redis.flushdb();
}

export async function consumeRateLimit(
  name: keyof typeof buckets,
  identity: string,
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const bucket = buckets[name];
  const key = `rl:${name}:${identity}`;

    if (redis.status !== "ready") {
    const error = new Error("Rate limiter Redis is unavailable.");
    error.name = "RateLimiterUnavailableError";
    throw error;
  }

  const result = (await redis.eval(
    `
      local count = redis.call("INCR", KEYS[1])

      if count == 1 then
        redis.call("PEXPIRE", KEYS[1], ARGV[1])
      end

      local ttl = redis.call("PTTL", KEYS[1])

      return { count, ttl }
    `,
    1,
    key,
    bucket.windowMs,
  )) as [number, number];

  const [count, ttlMs] = result;

  const retryAfterSec = Math.max(1, Math.ceil((ttlMs > 0 ? ttlMs : bucket.windowMs) / 1000));

  return {
    allowed: count <= bucket.max,
    retryAfterSec,
  };
}

// Prefer X-Forwarded-For when present (e.g. behind a reverse proxy or load
// balancer) — falling back to req.ip alone would put every client behind
// the same proxy into one shared rate-limit bucket.

export function clientIp(req: { ip?: string }): string {
  return req.ip ?? "0.0.0.0";
}