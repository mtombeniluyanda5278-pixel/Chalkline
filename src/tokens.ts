import {
  randomBytes,
  randomInt,
  randomUUID,
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import type { PoolClient } from "pg";
import { deliverDevOrLogEmail } from "./mail.js";
import { config } from "./config.js";
import { failure } from "./http.js";
export type Purpose =
  | "verify_email"
  | "reset_password"
  | "verify_recovery"
  | "change_email"
  | "account_discovery";
const policy = {
  verify_email: {
    minutes: config.TOKEN_VERIFY_EMAIL_MINUTES,
    route: "verify-email",
  },
  reset_password: {
    minutes: config.TOKEN_PASSWORD_RESET_MINUTES,
    route: "reset-password",
  },
  verify_recovery: {
    minutes: config.TOKEN_VERIFY_RECOVERY_MINUTES,
    route: "verify-recovery",
  },
  change_email: {
    minutes: config.TOKEN_CHANGE_EMAIL_MINUTES,
    route: "change-email",
  },
  account_discovery: {
    minutes: config.TOKEN_ACCOUNT_DISCOVERY_MINUTES,
    route: "discover-account",
  },
} as const;
const verificationDigest = (id: string, raw: string) =>
  createHmac("sha256", config.SESSION_SECRET)
    .update(`verify:${id}:${raw}`)
    .digest();
const digest = (raw: string) => createHash("sha256").update(raw).digest();
// Caller holds the user lock. Rotation and encrypted delivery always share its transaction.
export async function issueEmailToken(
  c: PoolClient,
  userId: string,
  purpose: Purpose,
  target: string,
  channel: "primary" | "recovery" = "primary",
) {
  const isCode = purpose === "verify_email";
  const id = randomUUID();
  const raw = isCode
    ? String(randomInt(0, 1000000)).padStart(6, "0")
    : randomBytes(32).toString("base64url");
  await c.query(
    "UPDATE email_tokens SET used_at=now() WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL",
    [userId, purpose],
  );
  const row = (
    await c.query(
      "INSERT INTO email_tokens(id,user_id,purpose,target_email,channel,token_hash,expires_at,auth_epoch) VALUES($7,$1,$2,$3,$4,$5,now()+($6::int*interval '1 minute'),(SELECT auth_epoch FROM users WHERE id=$1)) RETURNING id",
      [
        userId,
        purpose,
        target,
        channel,
        isCode ? verificationDigest(id, raw) : digest(raw),
        policy[purpose].minutes,
        id,
      ],
    )
  ).rows[0];
  const body = isCode
    ? `Your verification code is: ${raw}. Enter it on the verification page. It expires in ${policy[purpose].minutes} minutes. If you did not request it, ignore this email.`
    : `Continue securely: ${config.WEBAUTHN_ORIGIN}/#/${policy[purpose].route}?token=${encodeURIComponent(raw)}\nThis link expires in ${policy[purpose].minutes} minutes. If you did not request it, ignore this email.`;
  await deliverDevOrLogEmail(
    {
      userId,
      to: target,
      subject: `Chix: ${purpose.replaceAll("_", " ")}`,
      body,
    },
    c,
    `token:${row.id}`,
  );
  await c.query(
    "UPDATE notification_outbox SET expires_at=now()+($2::int*interval '1 minute') WHERE dedupe_key=$1",
    [`token:${row.id}`, policy[purpose].minutes],
  );
  return raw;
}

export async function consumeEmailToken(
  c: PoolClient,
  raw: string,
  purpose: Purpose,
) {
  if (purpose === "verify_email")
    throw failure(400, "Use your email and verification code.");
  const invalidMessage = "Invalid or expired link.";
  const hint = (
    await c.query(
      "SELECT user_id FROM email_tokens WHERE token_hash=$1 AND purpose=$2",
      [digest(raw), purpose],
    )
  ).rows[0];
  if (!hint) throw failure(400, invalidMessage);
  const user = (
    await c.query(
      "SELECT * FROM users WHERE id=$1 AND suspended_at IS NULL FOR UPDATE",
      [hint.user_id],
    )
  ).rows[0];
  if (!user) throw failure(400, invalidMessage);
  const token = (
    await c.query(
      "UPDATE email_tokens SET used_at=now() WHERE token_hash=$1 AND purpose=$2 AND used_at IS NULL AND expires_at>now() RETURNING *",
      [digest(raw), purpose],
    )
  ).rows[0];
  if (!token || token.auth_epoch !== user.auth_epoch)
    throw failure(400, invalidMessage);
  // Throwing rolls consumption back alongside the protected action.

  if (
    purpose === "reset_password" &&
    (String(
      token.channel === "primary" ? user.email : user.recovery_email,
    ).toLowerCase() !== String(token.target_email).toLowerCase() ||
      (token.channel === "recovery" && !user.recovery_verified_at))
  )
    throw failure(400, "Invalid or expired link.");
  return { token, user };
}

// Return invalid proof instead of throwing so failed-guess counts commit.
export async function consumeVerificationCode(
  c: PoolClient,
  email: string,
  code: string,
) {
  const user = (
    await c.query(
      "SELECT * FROM users WHERE email=$1 AND suspended_at IS NULL FOR UPDATE",
      [email],
    )
  ).rows[0];
  if (!user) return null;
  const token = (
    await c.query(
      "SELECT * FROM email_tokens WHERE user_id=$1 AND purpose='verify_email' AND used_at IS NULL AND expires_at>now() AND attempts<5 ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
      [user.id],
    )
  ).rows[0];
  if (
    !token ||
    String(token.target_email).toLowerCase() !==
      String(user.email).toLowerCase()
  )
    return null;
  await c.query("UPDATE email_tokens SET attempts=attempts+1 WHERE id=$1", [
    token.id,
  ]);
  if (!timingSafeEqual(token.token_hash, verificationDigest(token.id, code)))
    return null;
  await c.query("UPDATE email_tokens SET used_at=now() WHERE id=$1", [
    token.id,
  ]);
  return { user, token };
}
