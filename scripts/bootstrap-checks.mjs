import assert from "node:assert/strict";
import pg from "pg";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { ensureLocalDatabases, prepareDatabase } from "./local-bootstrap.mjs";
import { setupProduction } from "./setup-production.mjs";

async function withClient(url, action) {
  const c = new pg.Client({ connectionString: url });
  try {
    await c.connect();
    return await action(c);
  } finally {
    await c.end().catch(() => {});
  }
}
const denied = (action, code = "42501") => assert.rejects(action, { code });
export async function bootstrapChecks(env) {
  const rootUrl = env.LOCAL_OWNER_URL;
  for (const order of [
    ["dev", "test"],
    ["test", "dev"],
  ]) {
    const prefix = "boot_" + order[0];
    const ownerPassword = randomBytes(32).toString("hex");
    const ownerRole = prefix + "_owner";
    const targets = ["dev", "test"].map((kind) => {
      const url = new URL(rootUrl);
      url.pathname = "/" + prefix + "_" + kind;
      url.username = ownerRole;
      url.password = ownerPassword;
      const ownerUrl = url.toString();
      url.username = prefix + "_" + kind + "_app";
      url.password = randomBytes(32).toString("hex");
      return {
        ...env,
        DATABASE_URL: url.toString(),
        LOCAL_OWNER_URL: ownerUrl,
        STORAGE_USER_QUOTA_BYTES: "123456789",
        FREE_DOCUMENT_QUOTA_BYTES: "3456789",
        UPLOAD_MAX_BYTES: "1234567",
        UNVERIFIED_FILE_STORAGE_QUOTA_BYTES: "123",
        UNVERIFIED_DOCUMENT_QUOTA_BYTES: "234567",
      };
    });
    await withClient(rootUrl, async (root) => {
      await root.query(
        (
          await root.query(
            "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',$1::text,$2::text) AS sql",
            [ownerRole, ownerPassword],
          )
        ).rows[0].sql,
      );
      // Local database provisioning uses the cluster owner, as Compose does.
      await ensureLocalDatabases(root, targets);
      for (const target of targets) {
        const db = new URL(target.DATABASE_URL).pathname.slice(1);
        await root.query(`ALTER DATABASE ${db} OWNER TO ${ownerRole}`);
      }
      for (const kind of order) {
        const target = targets[kind === "dev" ? 0 : 1];
        await ensureLocalDatabases(root, targets);
        if (kind === order[0]) {
          const setup = spawnSync("npm", ["run", "db:setup:production"], {
            env: {
              ...process.env,
              ...target,
              MIGRATION_DATABASE_URL: target.LOCAL_OWNER_URL,
            },
            stdio: "inherit",
          });
          assert.equal(setup.status, 0, "fresh production operator command");
        } else await prepareDatabase(target);
        // Check both directions after EACH startup, including the first.
        for (const [index, own] of targets.entries()) {
          await withClient(own.DATABASE_URL, (c) => c.query("SELECT 1"));
          const cross = new URL(own.DATABASE_URL);
          cross.pathname = new URL(targets[1 - index].DATABASE_URL).pathname;
          await denied(() =>
            withClient(cross.toString(), (c) => c.query("SELECT 1")),
          );
        }
      }
      const target = targets[0];
      const role = new URL(target.DATABASE_URL).username;
      await root.query(
        `ALTER ROLE ${role} PASSWORD 'disposable-stale-password'`,
      );
      await denied(
        () => withClient(target.DATABASE_URL, (c) => c.query("SELECT 1")),
        "28P01",
      );
      await ensureLocalDatabases(root, targets);
      await withClient(target.LOCAL_OWNER_URL, async (owner) => {
        assert.equal(
          (
            await owner.query(
              "SELECT rolsuper FROM pg_roles WHERE rolname=current_user",
            )
          ).rows[0].rolsuper,
          false,
        );
        await owner.query(`REVOKE USAGE ON SCHEMA public FROM PUBLIC,${role}`);
      });
      await denied(() =>
        withClient(target.DATABASE_URL, (c) =>
          c.query("SELECT * FROM public.plans"),
        ),
      );
      await prepareDatabase(target);
      await withClient(target.LOCAL_OWNER_URL, async (owner) => {
        // Make ownership explicit so pg_database_owner membership cannot mask revocation.
        await owner.query(`ALTER SCHEMA public OWNER TO ${ownerRole}`);
        await owner.query(
          `REVOKE ALL ON SCHEMA public FROM PUBLIC,${ownerRole}`,
        );
        await denied(() =>
          owner.query("SELECT * FROM public.schema_migrations"),
        );
        await denied(() =>
          owner.query("CREATE TABLE public.must_not_exist(id int)"),
        );
      });
      await prepareDatabase(target);
      await prepareDatabase(target);
      // Exercise the actual production operator command's shared implementation.
      await setupProduction({
        ...target,
        MIGRATION_DATABASE_URL: target.LOCAL_OWNER_URL,
      });
      await withClient(target.DATABASE_URL, async (runtime) => {
        const privileges = (
          await runtime.query(
            "SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,has_schema_privilege(current_user,'public','CREATE') AS ddl FROM pg_roles WHERE rolname=current_user",
          )
        ).rows[0];
        assert.ok(Object.values(privileges).every((v) => v === false));
        await denied(() => runtime.query("SELECT * FROM schema_migrations"));
        await denied(() =>
          runtime.query("CREATE TABLE public.must_not_exist(id int)"),
        );
        const plans = (
          await runtime.query(
            "SELECT code,storage_quota_bytes::text,document_quota_bytes::text,upload_max_bytes::text FROM plans ORDER BY code",
          )
        ).rows;
        assert.deepEqual(plans, [
          {
            code: "FREE_BETA",
            storage_quota_bytes: "123456789",
            document_quota_bytes: "3456789",
            upload_max_bytes: "1234567",
          },
          {
            code: "UNVERIFIED",
            storage_quota_bytes: "123",
            document_quota_bytes: "234567",
            upload_max_bytes: "0",
          },
        ]);
        // RLS-enabled auth table is accessible through the deliberately permissive backend policy.
        const inserted = await runtime.query(
          "INSERT INTO users(email,username,first_name,last_name,country,date_of_birth) VALUES('bootstrap@example.test','bootstrap','Bootstrap','Check','ZA','2000-01-01') RETURNING id",
        );
        assert.equal(
          (
            await runtime.query("SELECT id FROM users WHERE id=$1", [
              inserted.rows[0].id,
            ])
          ).rowCount,
          1,
        );
        assert.equal(
          (
            await runtime.query("DELETE FROM users WHERE id=$1", [
              inserted.rows[0].id,
            ])
          ).rowCount,
          1,
        );
      });
    });
    console.log(
      `Bootstrap ${order.join(" → ")}: isolation after each startup, repeat, stale password, runtime and non-superuser owner schema repair, production setup, privileges and configured quotas passed.`,
    );
  }
}
