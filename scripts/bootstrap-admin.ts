import { z } from "zod";
import { pool } from "../src/db.js";
import { transaction } from "../src/transactions.js";
import { bootstrapAdmin } from "../src/adminBootstrap.js";

try {
  const args = z
    .tuple([z.literal("--apply"), z.uuid(), z.string().trim().min(10).max(300)])
    .parse(process.argv.slice(2));
  const changed = await transaction((client) =>
    bootstrapAdmin(client, args[1], args[2]),
  );
  console.log(
    changed
      ? "Administrator granted and existing sessions revoked. Sign in again."
      : "Account is already an administrator; no changes made.",
  );
} catch {
  console.error(
    "Admin bootstrap did not complete. Usage: node --import tsx scripts/bootstrap-admin.ts --apply ACCOUNT_UUID 'Operational reason'. Check account eligibility and database configuration. No account details or credentials were printed.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
