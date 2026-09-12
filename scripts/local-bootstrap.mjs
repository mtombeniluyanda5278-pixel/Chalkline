import pg from "pg";
import { spawnSync } from "node:child_process";
import { localEnvironment } from "./local-environment.mjs";
export async function bootstrapLocal() {
  const dev = await localEnvironment(),
    test = await localEnvironment(true);
  const owner = new pg.Client({
    connectionString: dev.LOCAL_OWNER_URL,
    connectionTimeoutMillis: 1000,
  });
  // A new client is necessary after failed connection attempts.
  let ready = false;
  for (let n = 0; n < 60; n++) {
    const probe = new pg.Client({
      connectionString: dev.LOCAL_OWNER_URL,
      connectionTimeoutMillis: 1000,
    });
    probe.on("error", () => {});
    try {
      await probe.connect();
      ready = true;
    } catch {
    } finally {
      await probe.end().catch(() => {});
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready)
    throw new Error("Local PostgreSQL unavailable. Run docker compose up -d.");
  await owner.connect();
  try {
    for (const env of [dev, test]) {
      const url = new URL(env.DATABASE_URL),
        role = url.username;
      if (
        !(await owner.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]))
          .rowCount
      ) {
        // Values come exclusively from the generated local configuration.
        const sql = (
          await owner.query(
            "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', $1::text,$2::text) AS sql",
            [role, url.password],
          )
        ).rows[0].sql;
        await owner.query(sql);
      }
    }
    if (
      !(
        await owner.query(
          "SELECT 1 FROM pg_database WHERE datname='chalkline_test'",
        )
      ).rowCount
    )
      await owner.query(
        "CREATE DATABASE chalkline_test OWNER chix_local_owner",
      );
  } finally {
    await owner.end();
  }
  for (const env of [dev, test]) {
    const migrated = spawnSync("node", ["scripts/migrate.mjs"], {
      env: { ...process.env, ...env, DATABASE_URL: env.LOCAL_OWNER_URL },
      stdio: "inherit",
    });
    if (migrated.status !== 0)
      throw new Error("Local migration failed; no existing data was removed.");
    const admin = new pg.Client({ connectionString: env.LOCAL_OWNER_URL });
    await admin.connect();
    try {
      const role = new URL(env.DATABASE_URL).username,
        db = new URL(env.DATABASE_URL).pathname.slice(1);
      await admin.query(
        `REVOKE CONNECT ON DATABASE ${db} FROM PUBLIC; GRANT CONNECT ON DATABASE ${db} TO ${role}; GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}; REVOKE ALL ON schema_migrations FROM ${role}`,
      );
      // The backend enforces owner checks. Runtime roles cannot alter schema,
      // grant privileges, bypass RLS, or connect to the other environment's DB.
      for (const table of [
        "users",
        "addresses",
        "sessions",
        "email_tokens",
        "webauthn_credentials",
      ]) {
        if (
          !(
            await admin.query(
              "SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=$1 AND policyname=$2",
              [table, role],
            )
          ).rowCount
        )
          await admin.query(
            `CREATE POLICY ${role} ON ${table} TO ${role} USING (true) WITH CHECK (true)`,
          );
      }
    } finally {
      await admin.end();
    }
  }
  console.log("Local migrations and restricted runtime roles ready.");
}
