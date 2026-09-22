import pg from "pg";
import { spawnSync } from "node:child_process";
import { localEnvironment } from "./local-environment.mjs";
export async function bootstrapLocal(testOnly = false) {
  const dev = await localEnvironment(),
    test = await localEnvironment(true);
  const targets = testOnly ? [test] : [dev];
  const owner = new pg.Client({
    connectionString: dev.LOCAL_OWNER_URL,
    connectionTimeoutMillis: 1000,
  });
  // A new client is necessary after failed connection attempts.
  let ready = false,
    lastCode;
  for (let n = 0; n < 60; n++) {
    const probe = new pg.Client({
      connectionString: dev.LOCAL_OWNER_URL,
      connectionTimeoutMillis: 1000,
    });
    probe.on("error", () => {});
    try {
      await probe.connect();
      ready = true;
    } catch (error) {
      lastCode = error.code;
    } finally {
      await probe.end().catch(() => {});
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) {
    if (lastCode === "28P01")
      console.error(
        "Local migration-owner credentials do not match the preserved volume. Restore the matching .local/credentials.json backup; no passwords or data were reset.",
      );
    throw new Error("Local PostgreSQL unavailable. Run docker compose up -d.");
  }
  await owner.connect();
  try {
    await ensureLocalDatabases(owner, [dev, test]);
  } finally {
    await owner.end();
  }
  for (const env of targets) await prepareDatabase(env);
  console.log("Local migrations and restricted runtime roles ready.");
}

// Secure both databases before either runtime starts, including test-first setup.
export async function ensureLocalDatabases(owner, environments) {
  for (const env of environments) await ensureRuntimeRole(owner, env);
  for (const env of environments) {
    const database = decodeURIComponent(
      new URL(env.DATABASE_URL).pathname.slice(1),
    );
    const role = decodeURIComponent(new URL(env.DATABASE_URL).username);
    if (
      !(
        await owner.query("SELECT 1 FROM pg_database WHERE datname=$1", [
          database,
        ])
      ).rowCount
    )
      await owner.query(`CREATE DATABASE ${quoteIdentifier(database)}`);
    await owner.query(
      `REVOKE CONNECT ON DATABASE ${quoteIdentifier(database)} FROM PUBLIC`,
    );
    for (const other of environments) {
      const otherRole = decodeURIComponent(
        new URL(other.DATABASE_URL).username,
      );
      await owner.query(
        `${otherRole === role ? "GRANT" : "REVOKE"} CONNECT ON DATABASE ${quoteIdentifier(database)} ${otherRole === role ? "TO" : "FROM"} ${quoteIdentifier(otherRole)}`,
      );
    }
  }
}
const quoteIdentifier = (value) => '"' + value.replaceAll('"', '""') + '"';

export async function ensureRuntimeRole(owner, env) {
  const url = new URL(env.DATABASE_URL);
  const exists = (
    await owner.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [
      decodeURIComponent(url.username),
    ])
  ).rowCount;
  const sql = (
    await owner.query(
      "SELECT format('%s ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', $1::text,$2::text,$3::text) AS sql",
      [
        exists ? "ALTER" : "CREATE",
        decodeURIComponent(url.username),
        decodeURIComponent(url.password),
      ],
    )
  ).rows[0].sql;
  await owner.query(sql);
}

export async function prepareDatabase(env) {
  const admin = new pg.Client({ connectionString: env.LOCAL_OWNER_URL });
  await admin.connect();
  const role = decodeURIComponent(new URL(env.DATABASE_URL).username);
  const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
  const runtime = quote(role),
    db = quote(decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1)));
  try {
    // Only the migration connection receives schema creation privileges.
    await admin.query("GRANT USAGE,CREATE ON SCHEMA public TO CURRENT_USER");
    const migrated = spawnSync("node", ["scripts/migrate.mjs"], {
      env: { ...process.env, ...env, DATABASE_URL: env.LOCAL_OWNER_URL },
      stdio: "inherit",
    });
    if (migrated.status !== 0)
      throw new Error(
        "Database migration failed; no existing data was removed.",
      );
    await admin.query(
      `REVOKE CONNECT ON DATABASE ${db} FROM PUBLIC; GRANT CONNECT ON DATABASE ${db} TO ${runtime}; REVOKE CREATE ON SCHEMA public FROM PUBLIC,${runtime}; GRANT USAGE ON SCHEMA public TO ${runtime}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${runtime}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${runtime}; REVOKE ALL ON schema_migrations FROM ${runtime}`,
    );
    // Backend owner predicates provide tenant isolation; RLS permits this backend role.
    const tables = (
      await admin.query(
        "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity",
      )
    ).rows;
    for (const { relname } of tables) {
      if (
        !(
          await admin.query(
            "SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=$1 AND policyname=$2",
            [relname, role],
          )
        ).rowCount
      )
        await admin.query(
          `CREATE POLICY ${runtime} ON ${quote(relname)} TO ${runtime} USING (true) WITH CHECK (true)`,
        );
    }
  } finally {
    await admin.end();
  }
  const configured = spawnSync(
    "node",
    ["--import", "tsx", "scripts/configure-plans.ts"],
    {
      env: {
        ...process.env,
        ...env,
        LOCAL_OWNER_URL: "",
        MIGRATION_DATABASE_URL: "",
      },
      stdio: "inherit",
    },
  );
  if (configured.status !== 0)
    throw new Error("Plan configuration failed after migrations.");
  await ensureBucket(env);
}

// Creates the local MinIO bucket with versioning on. objectStore().delete()
// lists and removes every version of a key, so an unversioned bucket would
// leave deleted files in place. Skipped when storage is not configured.
async function ensureBucket(env) {
  if (!env.STORAGE_ENDPOINT || !env.STORAGE_BUCKET) return;
  const { S3Client, CreateBucketCommand, PutBucketVersioningCommand } =
    await import("@aws-sdk/client-s3");
  const client = new S3Client({
    endpoint: env.STORAGE_ENDPOINT,
    region: env.STORAGE_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
    },
  });
  try {
    for (let n = 0; ; n++) {
      try {
        await client.send(
          new CreateBucketCommand({ Bucket: env.STORAGE_BUCKET }),
        );
        break;
      } catch (error) {
        const name = error?.name ?? "";
        if (
          name === "BucketAlreadyOwnedByYou" ||
          name === "BucketAlreadyExists"
        )
          break;
        if (n >= 40)
          throw new Error(
            "Local object storage unavailable. Run docker compose up -d.",
          );
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    await client.send(
      new PutBucketVersioningCommand({
        Bucket: env.STORAGE_BUCKET,
        VersioningConfiguration: { Status: "Enabled" },
      }),
    );
  } finally {
    client.destroy();
  }
}
