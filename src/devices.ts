import { randomBytes, randomInt } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { config } from "./config.js";
import { pool } from "./db.js";
import { transaction } from "./transactions.js";
import {
  lockSessionUser,
  hashToken,
  createSession,
  setSessionCookie,
  readSessionUser,
  destroySession,
  sessionTokens,
} from "./sessions.js";
import { requireUser, requireRecentAuth } from "./auth.js";
import { securityEvent } from "./security.js";
import { deliverDevOrLogEmail } from "./mail.js";
import { failure, parse, itemId, limit } from "./http.js";
const DEVICE_COOKIE = "chalkline_device",
  PENDING_COOKIE = "chalkline_pending";
const cookieOptions = {
  httpOnly: true,
  secure: config.COOKIE_SECURE,
  sameSite: "strict" as const,
  path: "/",
};
const label = (req: FastifyRequest) =>
  (req.headers["user-agent"] ?? "Browser").slice(0, 200);
// Session auth_method values that completeSignIn can record.
type SignInMethod = "password" | "passkey" | "email_otp" | "google" | "totp";
// Factors that prove possession of the browser's own mailbox/authenticator and
// so may establish trust by themselves. Everything else (a password, or a TOTP
// code that a phished user will read out) must be approved from a device the
// account already trusts.
const SELF_TRUSTING = new Set([
  "passkey",
  "registration",
  "email_otp",
  "google",
]);
async function trust(c: PoolClient, userId: string, deviceLabel: string) {
  const raw = randomBytes(32).toString("base64url");
  const row = (
    await c.query(
      `INSERT INTO trusted_devices(user_id,token_hash,label,expires_at) VALUES($1,$2,$3,now()+($4::int*interval '1 day')) RETURNING id`,
      [userId, hashToken(raw), deviceLabel, config.DEVICE_TRUST_DAYS],
    )
  ).rows[0];
  return { id: row.id as string, raw };
}
async function issue(
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  deviceId: string | undefined,
  raw: string | undefined,
  authEpoch: number | undefined,
  authMethod: SignInMethod,
) {
  const [old, ...duplicates] = sessionTokens(req);
  if (old) await destroySession(old, ...duplicates);
  const session = await createSession(userId, {
    ip: req.ip,
    userAgent: label(req),
    deviceId,
    authEpoch,
    authMethod,
  });
  setSessionCookie(reply, session);
  if (raw)
    reply.setCookie(DEVICE_COOKIE, raw, {
      ...cookieOptions,
      maxAge: config.DEVICE_TRUST_DAYS * 86400,
    });
  reply.clearCookie(PENDING_COOKIE, { path: "/" });
  await securityEvent(
    userId,
    "login_success",
    req.ip,
    undefined,
    req.headers["user-agent"],
  );
}
// Resolves this browser's trusted-device id inside a caller's transaction, for
// sign-in flows that must stay transactional and so cannot call completeSignIn.
// Without a device id the session falls back to 43200s and ignores session_days.
export async function deviceForSignIn(
  c: PoolClient,
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  trustDevice: boolean,
): Promise<string | undefined> {
  const known = req.cookies[DEVICE_COOKIE];
  if (known) {
    const found = (
      await c.query(
        "SELECT id FROM trusted_devices WHERE user_id=$1 AND token_hash=$2 AND revoked_at IS NULL AND expires_at>now()",
        [userId, hashToken(known)],
      )
    ).rows[0];
    if (found) {
      await c.query(
        "UPDATE trusted_devices SET last_seen_at=now() WHERE id=$1",
        [found.id],
      );
      return found.id;
    }
  }
  if (!trustDevice) return undefined;
  const device = await trust(c, userId, label(req));
  reply.setCookie(DEVICE_COOKIE, device.raw, {
    ...cookieOptions,
    maxAge: config.DEVICE_TRUST_DAYS * 86400,
  });
  return device.id;
}

export async function completeSignIn(
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  method: SignInMethod | "registration",
  trustDevice: boolean,
  authEpoch?: number,
) {
  // Sessions only get the user's session_days preference when they carry a
  // device id, so every method must reach one of the issue() calls below.
  // Registration completes by entering the emailed verification code, so that
  // is the factor the session actually rests on.
  const sessionMethod: SignInMethod =
    method === "registration" ? "email_otp" : method;
  // Device trust only applies AFTER the caller verifies password/passkey.
  const known = req.cookies[DEVICE_COOKIE];
  const found = known
    ? (
        await pool.query(
          "SELECT id FROM trusted_devices WHERE user_id=$1 AND token_hash=$2 AND revoked_at IS NULL AND expires_at>now()",
          [userId, hashToken(known)],
        )
      ).rows[0]
    : null;
  // A browser the account already trusts is recognised whatever the factor:
  // re-using its device id is what lets the session honour session_days.
  if (found) {
    await pool.query(
      "UPDATE trusted_devices SET last_seen_at=now() WHERE id=$1",
      [found.id],
    );
    await issue(
      req,
      reply,
      userId,
      found.id,
      undefined,
      authEpoch,
      sessionMethod,
    );
    return null;
  }
  // Verified UV passkey, account creation and mailbox-proving codes establish
  // trust without a second device.
  if (SELF_TRUSTING.has(method)) {
    const device = trustDevice
      ? await transaction((c) => trust(c, userId, label(req)))
      : undefined;
    await issue(
      req,
      reply,
      userId,
      device?.id,
      device?.raw,
      authEpoch,
      sessionMethod,
    );
    if (device)
      await securityEvent(
        userId,
        "device_trusted_" + method,
        req.ip,
        undefined,
        req.headers["user-agent"],
      );
    return null;
  }
  await limit("deviceChallenge", userId);
  const raw = randomBytes(32).toString("base64url"),
    number = randomInt(10, 100);
  const challenge = await transaction(async (c) => {
    await c.query(
      "UPDATE device_challenges SET status='denied' WHERE token_hash=$1 AND user_id=$2 AND status='pending'",
      [hashToken(req.cookies[PENDING_COOKIE] ?? ""), userId],
    );
    const row = (
      await c.query(
        "INSERT INTO device_challenges(user_id,token_hash,matching_number,label,ip,expires_at,auth_epoch) SELECT id,$2,$3,$4,$5,now()+interval '5 minutes',auth_epoch FROM users WHERE id=$1 AND auth_epoch=$6 RETURNING id,expires_at",
        [userId, hashToken(raw), number, label(req), req.ip, authEpoch],
      )
    ).rows[0];
    await securityEvent(
      userId,
      "new_device_detected",
      req.ip,
      c,
      req.headers["user-agent"],
    );
    await securityEvent(
      userId,
      "device_approval_requested",
      req.ip,
      c,
      req.headers["user-agent"],
    );
    return row;
  });
  reply.setCookie(PENDING_COOKIE, raw, { ...cookieOptions, maxAge: 300 });
  return { approvalRequired: true, number, expiresAt: challenge.expires_at };
}
async function pending(req: FastifyRequest) {
  const raw = req.cookies[PENDING_COOKIE];
  if (!raw) throw failure(401, "Start sign-in again.");
  const row = (
    await pool.query(
      "SELECT c.* FROM device_challenges c JOIN users u ON u.id=c.user_id AND u.auth_epoch=c.auth_epoch WHERE c.token_hash=$1 AND c.expires_at>now()",
      [hashToken(raw)],
    )
  ).rows[0];
  if (!row || row.status === "consumed")
    throw failure(401, "Approval expired. Start sign-in again.");
  return row;
}
async function lockPending(
  c: PoolClient,
  p: { user_id: string; auth_epoch: number },
) {
  const user = (
    await c.query(
      "SELECT auth_epoch,suspended_at FROM users WHERE id=$1 FOR UPDATE",
      [p.user_id],
    )
  ).rows[0];
  if (!user || user.suspended_at || user.auth_epoch !== p.auth_epoch)
    throw failure(401, "Start sign-in again.");
}
export async function registerDeviceRoutes(app: FastifyInstance) {
  app.get("/v1/devices/pending", async (req, reply) => {
    const row = await pending(req);
    return {
      status: row.status,
      number: row.matching_number,
      expiresAt: row.expires_at,
    };
  });
  app.post("/v1/devices/complete", async (req, reply) => {
    await limit("deviceApproval", req.ip);
    const p = await pending(req);
    const choice = parse(
      z.strictObject({ trustDevice: z.boolean().default(false) }),
      req.body ?? {},
    );
    const device = await transaction(async (c) => {
      await lockPending(c, p);
      const result = await c.query(
        "UPDATE device_challenges SET status='consumed' WHERE id=$1 AND token_hash=$2 AND status='approved' AND expires_at>now() RETURNING user_id,label",
        [p.id, hashToken(req.cookies[PENDING_COOKIE]!)],
      );
      if (!result.rows[0])
        throw failure(409, "Approval unavailable or already used.");
      return choice.trustDevice
        ? trust(c, result.rows[0].user_id, result.rows[0].label)
        : undefined;
    });
    // TOTP is the only factor outside SELF_TRUSTING, so it is the only one that
    // can have raised this challenge. Revisit if another joins it.
    await issue(
      req,
      reply,
      p.user_id,
      device?.id,
      device?.raw,
      p.auth_epoch,
      "totp",
    );
    return { ok: true };
  });
  app.get("/v1/me/devices", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const devices = await pool.query(
      "SELECT id,label,created_at,last_seen_at,expires_at,revoked_at FROM trusted_devices WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
      [user.id],
    );
    const pendingRequests = await pool.query(
      "SELECT id,label,created_at,expires_at FROM device_challenges WHERE user_id=$1 AND status='pending' AND expires_at>now() ORDER BY created_at DESC LIMIT 20",
      [user.id],
    );
    const events = await pool.query(
      "SELECT id,event,created_at,user_agent FROM security_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
      [user.id],
    );
    return {
      devices: devices.rows,
      pending: pendingRequests.rows,
      events: events.rows,
      currentDeviceId: user.deviceId,
    };
  });
  app.post("/v1/me/devices/requests/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!(await requireRecentAuth(user, reply))) return;
    await limit("deviceApproval", user.id);
    const b = parse(
      z.strictObject({
        decision: z.enum(["approve", "deny"]),
        number: z.number().int().min(10).max(99).optional(),
      }),
      req.body,
    );
    await transaction(async (c) => {
      await lockSessionUser(c, user, true);
      const device = (
        await c.query(
          "SELECT id FROM trusted_devices WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE",
          [user.deviceId, user.id],
        )
      ).rows[0];
      if (!device)
        throw failure(
          403,
          "Approval requires an existing trusted device. Sign in with a passkey or recover this device.",
        );
      const row = (
        await c.query(
          "SELECT * FROM device_challenges WHERE id=$1 AND user_id=$2 AND status='pending' AND expires_at>now() FOR UPDATE",
          [itemId(req), user.id],
        )
      ).rows[0];
      if (!row) throw failure(404, "Request unavailable or expired.");
      if (b.decision === "approve" && b.number !== row.matching_number)
        throw failure(
          400,
          "Numbers do not match. Check the requesting browser.",
        );
      await c.query(
        "UPDATE device_challenges SET status=$2,decided_by=$3 WHERE id=$1",
        [row.id, b.decision === "approve" ? "approved" : "denied", device.id],
      );
      await securityEvent(
        user.id,
        b.decision === "approve" ? "device_approved" : "device_denied",
        req.ip,
        c,
        req.headers["user-agent"],
      );
    });
    return { ok: true };
  });
  app.delete("/v1/me/devices/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!(await requireRecentAuth(user, reply))) return;
    await limit("deviceApproval", user.id);
    await transaction(async (c) => {
      await lockSessionUser(c, user, true);
      const result = await c.query(
        "UPDATE trusted_devices SET revoked_at=now() WHERE id=$1 AND user_id=$2 RETURNING id",
        [itemId(req), user.id],
      );
      if (!result.rowCount) throw failure(404, "Device not found.");
      await c.query("DELETE FROM sessions WHERE device_id=$1 AND user_id=$2", [
        itemId(req),
        user.id,
      ]);
      await c.query(
        "UPDATE device_challenges SET status='denied' WHERE user_id=$1 AND status IN ('pending','approved')",
        [user.id],
      );
      await securityEvent(
        user.id,
        "device_revoked",
        req.ip,
        c,
        req.headers["user-agent"],
      );
    });
    return { ok: true };
  });
  app.post("/v1/me/recovery-codes", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!(await requireRecentAuth(user, reply))) return;
    await limit("deviceApproval", user.id);
    const codes = Array.from({ length: 8 }, () =>
      randomBytes(32).toString("hex"),
    );
    await transaction(async (c) => {
      await lockSessionUser(c, user, true);
      await c.query("DELETE FROM recovery_codes WHERE user_id=$1", [user.id]);
      for (const code of codes)
        await c.query(
          "INSERT INTO recovery_codes(user_id,token_hash,expires_at) VALUES($1,$2,now()+$3::int*interval '1 day')",
          [user.id, hashToken(code), config.RECOVERY_CODE_DAYS],
        );
      await securityEvent(
        user.id,
        "recovery_codes_regenerated",
        req.ip,
        c,
        req.headers["user-agent"],
      );
    });
    return { codes };
  });
  app.post("/v1/devices/recovery/request", async (req, reply) => {
    const p = await pending(req);
    await limit("resendVerification", p.user_id);
    if (p.status !== "pending")
      throw failure(409, "Request no longer pending.");
    await transaction(async (c) => {
      await lockPending(c, p);
      const user = (
        await c.query(
          "SELECT email,email_verified_at,recovery_email,recovery_verified_at FROM users WHERE id=$1 FOR UPDATE",
          [p.user_id],
        )
      ).rows[0];
      if (!user || (!user.email_verified_at && !user.recovery_verified_at))
        throw failure(
          403,
          "Use a passkey, saved recovery code, or trusted device. Email recovery requires a verified address.",
        );
      const raw = randomBytes(32).toString("base64url");
      const changed = await c.query(
        "UPDATE device_challenges SET recovery_hash=$2 WHERE id=$1 AND status='pending' AND expires_at>now() RETURNING id",
        [p.id, hashToken(raw)],
      );
      if (!changed.rowCount) throw failure(409, "Request expired.");
      await deliverDevOrLogEmail(
        {
          userId: p.user_id,
          to: user.email_verified_at ? user.email : user.recovery_email,
          subject: "Approve your Chix browser",
          body: `Only continue if you started this sign-in. Open in the requesting browser: ${config.WEBAUTHN_ORIGIN}/#/device?token=${raw}`,
        },
        c,
      );
    });
    return { ok: true };
  });
  app.post("/v1/devices/recovery/confirm", async (req, reply) => {
    const p = await pending(req);
    await limit("deviceApproval", p.user_id);
    const b = parse(
      z.strictObject({ token: z.string().min(20).max(100) }),
      req.body,
    );
    await transaction(async (c) => {
      await lockPending(c, p);
      const row = (
        await c.query(
          "SELECT * FROM device_challenges WHERE id=$1 AND token_hash=$2 AND status='pending' AND expires_at>now() FOR UPDATE",
          [p.id, hashToken(req.cookies[PENDING_COOKIE]!)],
        )
      ).rows[0];
      if (!row) throw failure(409, "Recovery expired or used.");
      const code = await c.query(
        "DELETE FROM recovery_codes WHERE user_id=$1 AND token_hash=$2 AND expires_at>now() RETURNING user_id",
        [p.user_id, hashToken(b.token)],
      );
      if (
        !code.rowCount &&
        !(
          row.recovery_hash instanceof Buffer &&
          row.recovery_hash.equals(hashToken(b.token))
        )
      )
        throw failure(401, "Invalid recovery token.");
      await c.query(
        "UPDATE device_challenges SET status='approved',recovery_hash=NULL WHERE id=$1",
        [p.id],
      );
      await c.query(
        "UPDATE users SET pending_recovery_email=NULL WHERE id=$1",
        [p.user_id],
      );
      await c.query(
        "UPDATE email_tokens SET used_at=now() WHERE user_id=$1 AND purpose IN ('verify_recovery','change_email','reset_password') AND used_at IS NULL",
        [p.user_id],
      );
      // Recovery is also the lost-device path: invalidate previous sessions/trust.
      await c.query("DELETE FROM sessions WHERE user_id=$1", [p.user_id]);
      await c.query(
        "UPDATE trusted_devices SET revoked_at=now() WHERE user_id=$1",
        [p.user_id],
      );
      await c.query(
        "UPDATE device_challenges SET status='denied' WHERE user_id=$1 AND id<>$2 AND status IN ('pending','approved')",
        [p.user_id, p.id],
      );
      await securityEvent(
        p.user_id,
        "device_recovery_approved",
        req.ip,
        c,
        req.headers["user-agent"],
      );
    });
    return { ok: true };
  });
}
