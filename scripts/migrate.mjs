import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import pg from "pg";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(
    "SELECT pg_advisory_lock(hashtext('chalkline-migrations'))",
  );
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const files = (await readdir(new URL("../sql/", import.meta.url)))
    .filter((n) => /^\d+.*\.sql$/.test(n))
    .sort();
  const baseline = process.argv
    .find((s) => s.startsWith("--baseline="))
    ?.split("=")[1];
  // Explicit baseline ONLY after an operator confirms those migrations already ran.
  if (baseline && !/^\d{3}$/.test(baseline))
    throw new Error("Baseline must be a three-digit migration number.");
  for (const name of files) {
    const sql = await readFile(
        new URL("../sql/" + name, import.meta.url),
        "utf8",
      ),
      checksum = createHash("sha256").update(sql).digest("hex");
    const old = (
      await client.query(
        "SELECT checksum FROM schema_migrations WHERE name=$1",
        [name],
      )
    ).rows[0];
    if (old) {
      if (old.checksum !== checksum)
        throw new Error("Applied migration changed: " + name);
      continue;
    }
    await client.query("BEGIN");
    try {
      if (!baseline || name.slice(0, 3) > baseline) await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
      await client.query("COMMIT");
      console.log("Recorded " + name);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.end();
}
