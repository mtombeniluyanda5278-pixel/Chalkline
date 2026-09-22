import type { PoolClient } from "pg";
import { config } from "./config.js";

// Operational entry point only. Never register this function as an HTTP route.
export async function bootstrapAdmin(
  client: PoolClient,
  userId: string,
  reason: string,
) {
  const user = (
    await client.query(
      "SELECT role,email_verified_at,suspended_at,registration_pending,EXISTS(SELECT 1 FROM webauthn_credentials w WHERE w.user_id=u.id) AS has_passkey FROM users u WHERE id=$1 FOR UPDATE",
      [userId],
    )
  ).rows[0];
  if (
    !user ||
    !user.email_verified_at ||
    user.suspended_at ||
    user.registration_pending
  )
    throw new Error("An active verified account is required.");
  if (config.ADMIN_REQUIRE_PASSKEY && !user.has_passkey)
    throw new Error("Register a passkey before granting administrator access.");
  if (user.role === "admin") return false;
  await client.query(
    "UPDATE users SET role='admin',auth_epoch=auth_epoch+1 WHERE id=$1",
    [userId],
  );
  await client.query("DELETE FROM sessions WHERE user_id=$1", [userId]);
  await client.query(
    "INSERT INTO admin_audit_log(admin_user_id,target_user_id,action,metadata) VALUES($1,$1,'admin_bootstrap',$2)",
    [userId, { reason, source: "operator_cli" }],
  );
  return true;
}
