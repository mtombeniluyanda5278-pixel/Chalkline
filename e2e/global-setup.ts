// Clears rate-limit counters before a run. These are ephemeral Redis keys
// (rl:/fail:/risk:) used for throttling only — no session, database or storage
// data is touched. Without this, repeated local runs trip the signup limiter
// and every test fails with 429.
export default async function globalSetup() {
  const { localEnvironment } = await import("../scripts/local-environment.mjs");
  const env = (await localEnvironment()) as Record<string, string>;
  const { default: Redis } = await import("ioredis");
  const redis = new Redis(env.REDIS_URL);
  try {
    for (const pattern of ["rl:*", "fail:*", "risk:*"]) {
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          100,
        );
        cursor = next;
        if (keys.length) await redis.del(...keys);
      } while (cursor !== "0");
    }
  } finally {
    redis.disconnect();
  }
}
