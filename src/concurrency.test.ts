import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { concurrencyLease } from "./concurrency.js";
import { connectRedis, closeRedis, redis } from "./rateLimit.js";

before(connectRedis);
after(closeRedis);

test("shared leases renew, enforce capacity, and release without resurrection", async () => {
  const key = `test:lease:${randomUUID()}`;
  const limits = [{ key, max: 1 }];
  // Generous absolute margins: the property under test is that renewal keeps a
  // lease alive past its TTL, and a tight 1000ms window made that hostage to
  // event-loop jitter once the suite began exercising storage.
  const lease = await concurrencyLease(limits, { ttlMs: 3000, renewMs: 250 });
  assert.ok(lease);
  try {
    assert.equal(await concurrencyLease(limits), null);
    await delay(3600);
    assert.equal(lease.signal.aborted, false);
    assert.equal(await concurrencyLease(limits), null);
    await lease();
    await lease();
    await delay(500);
    assert.equal(await redis.zcard(key), 0);
    const next = await concurrencyLease(limits);
    assert.ok(next);
    await next();
  } finally {
    await lease();
    await redis.del(key);
  }
});

test("loss of any capacity token aborts work and cannot recreate the lost token", async () => {
  const keys = [randomUUID(), randomUUID()].map((id) => `test:lease:${id}`);
  const lease = await concurrencyLease(
    keys.map((key) => ({ key, max: 1 })),
    { ttlMs: 1000, renewMs: 100 },
  );
  assert.ok(lease);
  try {
    await redis.del(keys[0]!);
    await Promise.race([
      new Promise<void>((resolve) => {
        if (lease.signal.aborted) resolve();
        else
          lease.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
      }),
      delay(2000).then(() => {
        throw new Error("Lease did not abort");
      }),
    ]);
    assert.equal(lease.signal.aborted, true);
    assert.equal(await redis.zcard(keys[0]!), 0);
  } finally {
    await lease();
    await redis.del(...keys);
  }
});
