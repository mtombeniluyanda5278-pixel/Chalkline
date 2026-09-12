import { configurePlans } from "../src/quota.js";
import { pool } from "../src/db.js";
try {
  await configurePlans();
  console.log("Configured beta and unverified plan allowances. Existing content was preserved.");
} catch {
  console.error("Plan configuration failed. Check migration and configuration state.");
  process.exitCode=1;
} finally { await pool.end(); }
