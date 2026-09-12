import type { PoolClient } from "pg";
import { pool } from "./db.js";
import { encryptMail } from "./mail.js";
export async function securityEvent(
  userId: string,
  event: string,
  ip?: string,
  client: PoolClient | typeof pool = pool,
) {
  await client.query(
    "INSERT INTO security_events(user_id,event,ip) VALUES($1,$2,$3::inet)",
    [userId, event, ip ?? null],
  );
  if (!["password_changed","password_reset","email_changed","recovery_email_changed","recovery_email_removed","new_device_detected","device_revoked","passkey_added","passkey_removed","recovery_codes_created"].includes(event)) return;
  await client.query(
    `INSERT INTO notification_outbox(user_id,recipient,subject,encrypted_body) SELECT id,email,$2,$3 FROM users WHERE id=$1`,
    [
      userId,
      "Chix security activity",
      encryptMail(
        `At ${new Date().toISOString()} UTC. Security activity: ${event.replaceAll("_", " ")}. If this was not you, review Account / Security and revoke unfamiliar devices.`,
      ),
    ],
  );
}
