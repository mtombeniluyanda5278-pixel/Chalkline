import pgDriver from "pg";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = await mkdtemp(join(tmpdir(), "chalkline-tests-")),
  suffix = randomBytes(5).toString("hex"),
  password = randomBytes(32).toString("hex"),
  names = [];
const docker = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const port = (name) => docker(["port", name]).split(":").at(-1).trim();
async function start(name, image, args, env = {}) {
  const full = "chalkline-test-" + suffix + "-" + name;
  const file = join(dir, name + ".env");
  await writeFile(
    file,
    Object.entries(env)
      .map(([k, v]) => k + "=" + v)
      .join("\n"),
    { mode: 0o600 },
  );
  docker([
    "run",
    "-d",
    "--rm",
    "--name",
    full,
    "--env-file",
    file,
    ...args,
    image,
    ...(name === "redis"
      ? ["redis-server", "--requirepass", password]
      : name === "storage"
        ? ["server", "/data"]
        : []),
  ]);
  names.push(full);
  return full;
}
try {
  console.log(
    "Starting isolated PostgreSQL, Redis, and S3-compatible storage.",
  );
  const pg = await start(
    "postgres",
    "postgres:16-alpine",
    ["-p", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data"],
    {
      POSTGRES_PASSWORD: password,
      POSTGRES_USER: "test_runner",
      POSTGRES_DB: "chalkline_test",
    },
  );
  const redis = await start("redis", "redis:7-alpine", [
    "-p",
    "127.0.0.1::6379",
    "--tmpfs",
    "/data",
  ]);
  const storage = await start(
    "storage",
    "quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z",
    ["-p", "127.0.0.1::9000", "--tmpfs", "/data"],
    { MINIO_ROOT_USER: "test_runner", MINIO_ROOT_PASSWORD: password },
  );
  const env = {
    ...process.env,
    NODE_ENV: "test",
    CHIX_ISOLATED_TEST: "true",
    DATABASE_URL: `postgresql://test_runner:${password}@127.0.0.1:${port(pg)}/chalkline_test`,
    REDIS_URL: `redis://:${password}@127.0.0.1:${port(redis)}/15`,
    OUTBOX_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    RATE_LIMIT_KEY_SECRET: randomBytes(48).toString("hex"),
    BOT_PROTECTION_PROVIDER: "mock",
    BOT_REQUIRE_REGISTRATION: "false",
    MALWARE_SCANNER_MODE: "mock",
    SESSION_SECRET: randomBytes(48).toString("hex"),
    COOKIE_SECURE: "false",
    TRUST_PROXY: "false",
    WEBAUTHN_RP_ID: "localhost",
    WEBAUTHN_ORIGIN: "http://localhost:8080",
    STORAGE_ENDPOINT: `http://127.0.0.1:${port(storage)}`,
    STORAGE_REGION: "us-east-1",
    STORAGE_BUCKET: "chalkline-tests",
    STORAGE_ACCESS_KEY_ID: "test_runner",
    STORAGE_SECRET_ACCESS_KEY: password,
    EMAIL_DELIVERY_URL: "",
    EMAIL_DELIVERY_TOKEN: "",
    EMAIL_REQUIRED: "false",
  };
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const probe = new pgDriver.Client({
      connectionString: env.DATABASE_URL,
      connectionTimeoutMillis: 1000,
    });
    probe.on("error", () => {});
    try {
      await probe.connect();
      await probe.query("SELECT 1");
      const r = await fetch(env.STORAGE_ENDPOINT + "/minio/health/live", {
        signal: AbortSignal.timeout(1000),
      });
      ready = r.ok;
    } catch {
    } finally {
      await probe.end().catch(() => {});
    }
    if (ready) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) throw new Error("Isolated services did not become ready.");
  const migration = spawnSync("node", ["scripts/migrate.mjs"], {
    env,
    stdio: "inherit",
  });
  if (migration.status !== 0) throw new Error("Migration failed.");
  // Check idempotency/checksum ledger without replaying applied DDL.
  const repeated = spawnSync("node", ["scripts/migrate.mjs"], {
    env,
    stdio: "inherit",
  });
  if (repeated.status !== 0) throw new Error("Migration repeat failed.");
  const tests = spawnSync("npm", ["test"], { env, stdio: "inherit" });
  process.exitCode = tests.status ?? 1;
} finally {
  for (const name of names.reverse()) {
    try {
      docker(["stop", name]);
    } catch {
      console.error("Could not stop test container " + name);
    }
  }
  await rm(dir, { recursive: true, force: true });
}
