// Deliberate operator command. Does not load .env or create/alter credentials.
import pg from "pg";
import { prepareDatabase } from "./local-bootstrap.mjs";
export async function setupProduction(env = process.env) {
  if (!env.MIGRATION_DATABASE_URL || !env.DATABASE_URL)
    throw new Error(
      "Set separate MIGRATION_DATABASE_URL and runtime DATABASE_URL.",
    );
  const migration = new URL(env.MIGRATION_DATABASE_URL);
  const runtime = new URL(env.DATABASE_URL);
  if (
    migration.username === runtime.username ||
    migration.host !== runtime.host ||
    migration.pathname !== runtime.pathname
  )
    throw new Error(
      "Use distinct roles on the same PostgreSQL database and endpoint.",
    );
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    const {
      rows: [role],
    } =
      await client.query(`SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,
      EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND datdba=pg_roles.oid) AS owns_database,
      EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=pg_roles.oid) AS owns_schema,
      EXISTS(SELECT 1 FROM pg_class WHERE relowner=pg_roles.oid) AS owns_relation,
      EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid) AS member
      FROM pg_roles WHERE rolname=current_user`);
    if (Object.values(role).some(Boolean))
      throw new Error(
        "Runtime must be a restricted, standalone non-owner role.",
      );
  } finally {
    await client.end();
  }
  await prepareDatabase({
    ...env,
    DOTENV_CONFIG_PATH: ".local/no-dotenv",
    LOCAL_OWNER_URL: env.MIGRATION_DATABASE_URL,
  });
}
if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  try {
    await setupProduction();
  } catch {
    console.error(
      "Production setup failed. Check credentials, ownership, configuration and migration output; no data was reset.",
    );
    process.exitCode = 1;
  }
}
