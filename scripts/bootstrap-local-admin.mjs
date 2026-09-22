// Explicitly local-only operator entry point; never use the production .env DB.
import pg from "pg";
import { spawnSync } from "node:child_process";
import { localEnvironment } from "./local-environment.mjs";
import { bootstrapLocal } from "./local-bootstrap.mjs";
const [mode, email] = process.argv.slice(2);
if (mode !== "--apply" || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: node scripts/bootstrap-local-admin.mjs --apply EMAIL");
  process.exitCode = 1;
} else {
  let client;
  try {
    await bootstrapLocal();
    const env = await localEnvironment();
    client = new pg.Client({ connectionString: env.DATABASE_URL });
    await client.connect();
    const result = await client.query(
      "SELECT id FROM users WHERE lower(email)=lower($1)",
      [email.trim()],
    );
    if (result.rowCount !== 1) throw new Error("No unique local account");
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/bootstrap-admin.ts",
        "--apply",
        result.rows[0].id,
        "Account owner requested administrator access for localhost",
      ],
      {
        env: { ...process.env, ...env, LOCAL_OWNER_URL: "" },
        stdio: "inherit",
      },
    );
    process.exitCode = child.status ?? 1;
  } catch {
    console.error(
      "Local promotion did not complete. Check that the local database is running and the exact email belongs to an active verified account.",
    );
    process.exitCode = 1;
  } finally {
    await client?.end();
  }
}
