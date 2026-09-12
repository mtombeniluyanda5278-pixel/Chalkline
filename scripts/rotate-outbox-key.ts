import { config } from "../src/config.js";
import { pool } from "../src/db.js";
import { transaction } from "../src/transactions.js";
import { openMail, sealMail } from "../src/mailCipher.js";

// Run with delivery workers paused and both explicit keys configured. One failed
// envelope rolls the entire rewrap back; plaintext and credentials never print.
try {
  if (!config.OUTBOX_PREVIOUS_ENCRYPTION_KEY) throw new Error("A previous key must be explicitly configured.");
  const count = await transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('chix:outbox-key-rotation'))");
    const rows = (await client.query("SELECT id,encrypted_body FROM notification_outbox WHERE encrypted_body IS NOT NULL FOR UPDATE")).rows;
    for (const row of rows) {
      const plaintext = openMail(row.encrypted_body, config.OUTBOX_ENCRYPTION_KEY!, config.OUTBOX_PREVIOUS_ENCRYPTION_KEY);
      await client.query("UPDATE notification_outbox SET encrypted_body=$2 WHERE id=$1", [row.id,sealMail(plaintext,config.OUTBOX_ENCRYPTION_KEY!)]);
    }
    return rows.length;
  });
  console.log(`Re-encrypted ${count} outbox messages. No token state was changed.`);
} catch {
  console.error("Outbox rotation failed and rolled back. Check explicit keys and database access; no secrets were printed.");
  process.exitCode=1;
} finally { await pool.end(); }
