#!/bin/sh
# Operator task, run from deploy/: once at install and after every release.
#   docker compose --profile bootstrap run --rm bootstrap
#
# Creates the migration-owner and runtime roles from the two connection URLs,
# then hands over to the repository's own production setup, which applies
# checksum-checked migrations, runtime grants, RLS policies, quotas and the
# storage bucket. Re-running it preserves existing data.
set -eu

: "${POSTGRES_ADMIN_URL:?set POSTGRES_ADMIN_URL in .env.bootstrap}"
: "${MIGRATION_DATABASE_URL:?set MIGRATION_DATABASE_URL in .env.bootstrap}"
: "${DATABASE_URL:?set DATABASE_URL in .env}"

node --input-type=module <<'NODE'
import pg from "pg";

const migration = new URL(process.env.MIGRATION_DATABASE_URL);
const runtime = new URL(process.env.DATABASE_URL);
const database = decodeURIComponent(migration.pathname.slice(1));
const roles = [migration, runtime].map((url) => ({
  name: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
}));

const admin = new pg.Client({ connectionString: process.env.POSTGRES_ADMIN_URL });
await admin.connect();

// Postgres does its own quoting through format(): CREATE ROLE and CREATE
// DATABASE cannot take bind parameters, and passwords must not be concatenated.
const exec = async (template, ...values) => {
  const { rows } = await admin.query(
    `SELECT format($1::text${values.map((_, i) => `, $${i + 2}::text`).join("")}) AS sql`,
    [template, ...values],
  );
  await admin.query(rows[0].sql);
};

try {
  for (const role of roles) {
    const exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [
      role.name,
    ]);
    await exec(
      `${exists.rowCount ? "ALTER" : "CREATE"} ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      role.name,
      role.password,
    );
  }

  const present = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [
    database,
  ]);
  if (!present.rowCount)
    await exec("CREATE DATABASE %I OWNER %I", database, roles[0].name);

  await exec("REVOKE CONNECT ON DATABASE %I FROM PUBLIC", database);
  for (const role of roles)
    await exec("GRANT CONNECT ON DATABASE %I TO %I", database, role.name);

  console.log(
    `Roles ${roles.map((r) => r.name).join(", ")} ready on database ${database}.`,
  );
} finally {
  await admin.end();
}
NODE

node scripts/setup-production.mjs
echo "Bootstrap complete."
