import type { PoolClient } from "pg";
import { pool } from "./db.js";
import { encryptMail } from "./mail.js";
export async function securityEvent(
  userId: string,
  event: string,
  ip?: string,
  client: PoolClient | typeof pool = pool,
) {
  const created = await client.query(
    "INSERT INTO security_events(user_id,event,ip) VALUES($1,$2,$3::inet) RETURNING id,created_at",
    [userId, event, ip ?? null],
  );
  if (
    ![
      "password_changed",
      "password_reset",
      "email_changed",
      "recovery_email_changed",
      "recovery_email_removed",
      "new_device_detected",
      "device_revoked",
      "passkey_added",
      "passkey_removed",
      "recovery_codes_created",
      "login_success",
    ].includes(event)
  )
    return;
  const user = (await client.query("SELECT email,email_verified_at,recovery_email,recovery_verified_at,timezone FROM users WHERE id=$1", [userId])).rows[0];
  if (!user) return;
  const when = new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:user.timezone}).format(created.rows[0].created_at);
  const encrypted = encryptMail(`At ${when} (${user.timezone}). Security activity: ${event.replaceAll('_',' ')}. If this was not you, review Account / Security and revoke unfamiliar devices.`);
  const destinations = new Set<string>([user.email_verified_at && user.email, user.recovery_verified_at && user.recovery_email].filter(Boolean));
  for (const [index, recipient] of [...destinations].entries())
    await client.query("INSERT INTO notification_outbox(user_id,recipient,subject,encrypted_body,dedupe_key) VALUES($1,$2,'Chix security activity',$3,$4) ON CONFLICT(dedupe_key) DO NOTHING",[userId,recipient,encrypted,`security:${created.rows[0].id}:${index}`]);
}
