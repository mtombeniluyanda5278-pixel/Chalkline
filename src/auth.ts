import { randomInt } from "node:crypto";
import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import { config } from "./config.js";
import { issueEmailToken, consumeEmailToken } from "./tokens.js";
import { verifyBot, loginProtection, failedLogin, recoveryProtection } from "./bot.js";
import { completeSignIn } from "./devices.js";
import { securityEvent } from "./security.js";
import { authLink } from "./mail.js";
import { transaction } from "./transactions.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { pool } from "./db.js";
import {
  deliverDevOrLogEmail,
  sendAdminAccountCreatedNotification,
} from "./mail.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { buckets, clientIp, consumeRateLimit } from "./rateLimit.js";
import {
  hashToken,
  clearSessionCookie,
  createOneTimeToken,
  createSession,
  destroyAllSessions,
  destroyOtherSessions,
  destroySession,
  destroySessionById,
  listSessions,
  markSessionReauthenticated,
  lockSessionUser,
  readSessionUser,
  setSessionCookie,
  sessionTokens,
  type SessionUser,
} from "./sessions.js";

import {
  AccountDeleteInput,
  EmailChangeInput,
  LoginInput,
  PasswordChangeInput,
  PasswordResetConfirmInput,
  PasswordResetRequestInput,
  PhoneChangeInput,
  ProfileUpdateInput,
  RegisterInput,
  UsernameChangeInput,
  VerifyEmailInput,
} from "./validation.js";

const DUMMY_ARGON2 =
  "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

async function rateLimitOr429(
  reply: FastifyReply,
  name: keyof typeof buckets,
  identity: string,
): Promise<boolean> {
  const result = await consumeRateLimit(name, identity);
  if (!result.allowed) {
    reply.header("Retry-After", String(result.retryAfterSec));
    await reply
      .code(429)
      .send({ error: "Too many requests. Try again later." });
    return false;
  }
  return true;
}

function publicUser(row: {
  id: string;
  email: string;
  username: string;
  first_name: string;
  last_name: string;
  country: string;
  email_verified_at: Date | null;
  phone_verified_at: Date | null;
}) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    country: row.country,
    emailVerified: Boolean(row.email_verified_at),
    phoneVerified: Boolean(row.phone_verified_at),
  };
}

export async function requireUser(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<SessionUser | null> {
  const user = await readSessionUser(req);

  if (!user) {
    await reply.code(401).send({
      error: "Authentication required.",
      code: "UNAUTHENTICATED",
    });
    return null;
  }

  return user;
}

// How long a session counts as "freshly authenticated" (password entry,
// passkey login, or a re-checked current password) for step-up gating.
// Deliberately much shorter than the 7-day session TTL: holding a valid
// cookie is enough to browse the account, but not enough to do things like
// register a new passkey, which would let someone bypass the password
// entirely on future logins.
export const STEP_UP_WINDOW_MS = 10 * 60 * 1000;

export async function requireRecentAuth(
  sessionUser: SessionUser,
  reply: FastifyReply,
  maxAgeMs: number = STEP_UP_WINDOW_MS,
): Promise<boolean> {
  const ageMs = Date.now() - sessionUser.reauthenticatedAt.getTime();
  if (ageMs > maxAgeMs) {
    await reply.code(401).send({
      error: "Please sign in again to continue.",
      code: "REAUTH_REQUIRED",
    });
    return false;
  }
  return true;
}

const registrationResponse = {
  ok:true, verificationRequired:true,
  message:"Check your email to continue. If you already have an account, sign in or use account recovery.",
};

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/auth/register", async (req, reply) => {
    const ip = clientIp(req);
    if (!(await rateLimitOr429(reply, "signup", ip))) return;

    const parsed = RegisterInput.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid input.", details: parsed.error.flatten() });
    }
    const body = parsed.data;
    if (config.BOT_REQUIRE_REGISTRATION)
      await verifyBot(body.captchaToken, "register");
    // Both fresh and conflicting registrations pay the password-hash cost.
    // A shared response floor with jitter also covers ordinary transaction variance.
    const respondAt = performance.now() + 400 + randomInt(101);
    const finishRegistration = async () => {
      await delay(Math.max(0, respondAt - performance.now()));
      return reply.code(201).send(registrationResponse);
    };
    const passwordHash = await hashPassword(body.password);

    const client = await pool.connect();
    let transactionCommitted = false;

    try {
      await client.query("BEGIN");

      const userInsert = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO users (
           email, username, password_hash, first_name, last_name, country, date_of_birth,
           phone_e164, marketing_announcements, marketing_apps, consents_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
         RETURNING id, created_at`,
        [
          body.email,
          body.username,
          passwordHash,
          body.firstName,
          body.lastName,
          body.country,
          body.dateOfBirth,
          body.phone ?? null,
          body.marketingAnnouncements,
          body.marketingApps,
        ],
      );
      const userRow = userInsert.rows[0]!;
      const userId = userRow.id;
      if (body.address)
        await client.query(
          `INSERT INTO addresses (user_id, line1, line2, city, region, postal_code, country)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            userId,
            body.address.line1,
            body.address.line2 ?? null,
            body.address.city,
            body.address.region ?? null,
            body.address.postalCode,
            body.address.country,
          ],
        );
      await client.query(
        "UPDATE users SET session_days=$2,timezone=$3,registration_pending=true,registration_trust_device=$4 WHERE id=$1",
        [userId, config.SESSION_DEFAULT_DAYS, body.timezone, body.trustDevice],
      );
      await issueEmailToken(client, userId, "verify_email", body.email);
      await client.query(
        "INSERT INTO security_events(user_id,event) VALUES($1,'account_created')",
        [userId],
      );
      await sendAdminAccountCreatedNotification(
        { userId, createdAt: userRow.created_at },
        client,
      );
      await client.query("COMMIT");
      transactionCommitted = true;

      return await finishRegistration();
    } catch (err: unknown) {
      if (transactionCommitted) {
        req.log.warn({requestId:req.id}, "Account committed; registration finalization interrupted");
        return await finishRegistration();
      }
      if (!transactionCommitted) {
        await client.query("ROLLBACK");
      }
      const code =
        typeof err === "object" && err && "code" in err
          ? String((err as { code: string }).code)
          : "";
      if (code === "23505") {
        req.log.info(
          { requestId: req.id, code: "REGISTRATION_UNAVAILABLE" },
          "Registration conflict",
        );
        return await finishRegistration();
      }
      req.log.error("Account operation failed");
      return reply.code(500).send({ error: "Could not create account." });
    } finally {
      client.release();
    }
  });

  app.post("/v1/auth/login", async (req, reply) => {
    const ip = clientIp(req);
    const parsed = LoginInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input." });
    }
    if (!(await rateLimitOr429(reply, "login", ip))) return;

    await loginProtection(parsed.data.email, ip, parsed.data.captchaToken);
    const found = await pool.query<{
      id: string;
      auth_epoch: number;
      registration_pending: boolean;
      password_hash: string | null;
      locked_until: Date | null;
      email: string;
      username: string;
      first_name: string;
      last_name: string;
      country: string;
      email_verified_at: Date | null;
      phone_verified_at: Date | null;
    }>(
      `SELECT id, auth_epoch, registration_pending, password_hash, locked_until, email, username, first_name, last_name, country,
              email_verified_at, phone_verified_at
         FROM users WHERE email = $1 AND suspended_at IS NULL`,
      [parsed.data.email],
    );
    const user = found.rows[0];

    // Always run verifyPassword against *something* — a real hash if the
    // account exists and has one, DUMMY_ARGON2 otherwise — before any early
    // return. If we returned early for "no account" / "no password" /
    // "locked" without doing this, those cases would respond measurably
    // faster than a real wrong-password attempt, leaking which one applies
    // to a given email via response timing.
    const hash = user?.password_hash ?? DUMMY_ARGON2;
    const passwordOk = await verifyPassword(hash, parsed.data.password);

    if (!user || !user.password_hash || !passwordOk || user.registration_pending) {
      await failedLogin(parsed.data.email, ip);
      if (user) await securityEvent(user.id, "login_failed", ip);
      return reply.code(401).send({ error: "Invalid email or password." });
    }
    const approval = await completeSignIn(
      req,
      reply,
      user.id,
      "password",
      parsed.data.trustDevice,
      user.auth_epoch,
    );
    if (approval) return reply.code(202).send(approval);

    return { user: publicUser(user) };
  });

  app.post("/v1/auth/reauth", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!(await rateLimitOr429(reply, "passwordChange", user.id))) return;
    const body = req.body as { password?: unknown } | undefined;
    if (typeof body?.password !== "string" || body.password.length > 72)
      return reply.code(400).send({ error: "Invalid request." });
    const row = (
      await pool.query("SELECT password_hash FROM users WHERE id=$1", [user.id])
    ).rows[0];
    if (
      !row?.password_hash ||
      !(await verifyPassword(row.password_hash, body.password))
    )
      return reply.code(401).send({ error: "Current password is incorrect." });
    await transaction(async c => {
      const current=await lockSessionUser(c,user);
      if(current.password_hash!==row.password_hash) throw Object.assign(new Error("Credentials changed. Try again."),{statusCode:409});
      await c.query("UPDATE sessions SET reauthenticated_at=now(),auth_method='password' WHERE id=$1",[user.sessionId]);
    });
    return { ok: true };
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    const actor = await readSessionUser(req);
    if (actor) await securityEvent(actor.id, "logout", req.ip);
    const [raw, ...duplicates] = sessionTokens(req);
    if (raw) await destroySession(raw, ...duplicates);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/v1/me", async (req, reply) => {
    const sessionUser = await requireUser(req, reply);
    if (!sessionUser) return;
    const result = await pool.query(
      `SELECT u.id, u.email, u.username, u.first_name, u.last_name, u.country,
              u.email_verified_at, u.phone_verified_at,
              a.line1, a.line2, a.city, a.region, a.postal_code, a.country AS address_country
         FROM users u
         LEFT JOIN addresses a ON a.user_id = u.id
        WHERE u.id = $1`,
      [sessionUser.id],
    );
    const row = result.rows[0];
    if (!row) return reply.code(404).send({ error: "Not found." });
    return {
      user: publicUser(row),
      address: {
        line1: row.line1,
        line2: row.line2,
        city: row.city,
        region: row.region,
        postalCode: row.postal_code,
        country: row.address_country,
      },
    };
  });

  // Full data export. Gated by requireRecentAuth since it dumps everything
  // tied to the account (sessions, tokens, credentials included) — a stale
  // hijacked session shouldn't be able to exfiltrate this quietly.
  app.post("/v1/me/email", async (req, reply) => {
    const sessionUser = await requireUser(req, reply);
    if (!sessionUser) return;

    if (!(await rateLimitOr429(reply, "emailChange", sessionUser.id))) return;

    const parsed = EmailChangeInput.safeParse(req.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request.",
        details: parsed.error.flatten(),
      });
    }

    const { email, currentPassword } = parsed.data;

    const found = await pool.query<{
      password_hash: string | null;
      email: string;
    }>(
      `SELECT password_hash, email
         FROM users
        WHERE id = $1`,
      [sessionUser.id],
    );

    const row = found.rows[0];

    if (!row || !row.password_hash) {
      return reply.code(401).send({
        error: "Current password is incorrect.",
      });
    }

    const passwordOk = await verifyPassword(row.password_hash, currentPassword);

    if (!passwordOk) {
      return reply.code(401).send({
        error: "Current password is incorrect.",
      });
    }

    await markSessionReauthenticated(sessionUser.sessionId);

    if (email === row.email) {
      return { ok: true, unchanged: true };
    }

    await transaction(async (c) => {
      const current = (
        await c.query(
          "SELECT email,password_hash FROM users WHERE id=$1 FOR UPDATE",
          [sessionUser.id],
        )
      ).rows[0];
      if (
        current.email !== row.email ||
        current.password_hash !== row.password_hash
      )
        throw Object.assign(new Error("Credentials changed. Try again."), {
          statusCode: 409,
        });
      await issueEmailToken(c, sessionUser.id, "change_email", email);
      await securityEvent(sessionUser.id, "email_change_requested", req.ip, c);
    });
    return { ok: true, emailVerificationRequired: true };
  });

  app.patch("/v1/me", async (req, reply) => {
    const sessionUser = await requireUser(req, reply);
    if (!sessionUser) return;
    const parsed = ProfileUpdateInput.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid input.", details: parsed.error.flatten() });
    }
    const body = parsed.data;
    if (body.firstName || body.lastName) {
      await pool.query(
        `UPDATE users SET
           first_name = COALESCE($2, first_name),
           last_name = COALESCE($3, last_name),
           updated_at = now()
         WHERE id = $1`,
        [sessionUser.id, body.firstName ?? null, body.lastName ?? null],
      );
    }
    if (body.address) {
      await pool.query(
        `UPDATE addresses SET
           line1 = $2, line2 = $3, city = $4, region = $5, postal_code = $6, country = $7, updated_at = now()
         WHERE user_id = $1`,
        [
          sessionUser.id,
          body.address.line1,
          body.address.line2 ?? null,
          body.address.city,
          body.address.region ?? null,
          body.address.postalCode,
          body.address.country,
        ],
      );
    }
    return { ok: true };
  });

  app.post("/v1/me/username", async (req, reply) => {
    const sessionUser = await requireUser(req, reply);
    if (!sessionUser) return;
    if (!(await rateLimitOr429(reply, "accountChange", sessionUser.id))) return;

    const parsed = UsernameChangeInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request.",
        details: parsed.error.flatten(),
      });
    }

    const { username, currentPassword } = parsed.data;

    const found = await pool.query<{
      password_hash: string | null;
      username: string;
    }>(
      `SELECT password_hash, username
         FROM users
        WHERE id = $1`,
      [sessionUser.id],
    );

    const row = found.rows[0];

    if (!row || !row.password_hash) {
      return reply.code(401).send({
        error: "Current password is incorrect.",
      });
    }

    const passwordOk = await verifyPassword(row.password_hash, currentPassword);

    if (!passwordOk) {
      return reply.code(401).send({
        error: "Current password is incorrect.",
      });
    }

    await markSessionReauthenticated(sessionUser.sessionId);

    if (username === row.username) {
      return { ok: true, unchanged: true };
    }

    try {
      await pool.query(
        `UPDATE users
            SET username = $2,
                updated_at = now()
          WHERE id = $1`,
        [sessionUser.id, username],
      );
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        err.code === "23505"
      ) {
        return reply.code(409).send({
          error: "That username is already in use.",
        });
      }

      throw err;
    }

    await destroyAllSessions(sessionUser.id);
    clearSessionCookie(reply);

    return {
      ok: true,
    };
  });

  app.post("/v1/me/phone", async (req, reply) => {
    const sessionUser = await requireUser(req, reply);
    if (!sessionUser) return;

    if (!(await rateLimitOr429(reply, "accountChange", sessionUser.id))) return;

    const parsed = PhoneChangeInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request.",
        details: parsed.error.flatten(),
      });
    }

    const { phone, currentPassword } = parsed.data;

    const found = await pool.query<{
      password_hash: string | null;
      phone_e164: string | null;
    }>(
      `SELECT password_hash, phone_e164
         FROM users
        WHERE id = $1`,
      [sessionUser.id],
    );

    const row = found.rows[0];

    if (!row || !row.password_hash) {
      return reply.code(401).send({
        error: "Current password is incorrect.",
      });
    }

    const passwordOk = await verifyPassword(row.password_hash, currentPassword);

    if (!passwordOk) {
      return reply.code(401).send({
        error: "Current password is incorrect.",
      });
    }

    await markSessionReauthenticated(sessionUser.sessionId);

    if (phone === row.phone_e164) {
      return { ok: true, unchanged: true };
    }

    await pool.query(
      `UPDATE users
          SET phone_e164 = $2,
              phone_verified_at = NULL,
              updated_at = now()
        WHERE id = $1`,
      [sessionUser.id, phone],
    );

    return {
      ok: true,
      phoneVerificationRequired: true,
    };
  });

  app.post("/v1/me/password", async (req, reply) => {
    const sessionUser = await requireUser(req, reply);
    if (!sessionUser) return;
    if (!(await rateLimitOr429(reply, "passwordChange", sessionUser.id)))
      return;

    const parsed = PasswordChangeInput.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid input.", details: parsed.error.flatten() });
    }
    const body = parsed.data;

    const found = await pool.query<{ password_hash: string | null }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [sessionUser.id],
    );
    const row = found.rows[0];
    const hash = row?.password_hash ?? DUMMY_ARGON2;
    const currentOk = await verifyPassword(hash, body.currentPassword);

    if (!row || !row.password_hash || !currentOk) {
      return reply.code(401).send({
        error: "Current password is incorrect.",
      });
    }

    // The current password was just verified; an older timestamp is irrelevant.
    if (await verifyPassword(hash, body.newPassword))
      return reply
        .code(400)
        .send({ error: "Choose a different new password." });

    const newHash = await hashPassword(body.newPassword);
    const changed = await transaction(async (c) => {
      const r = await c.query(
        "UPDATE users SET password_hash=$2,auth_epoch=auth_epoch+1,updated_at=now() WHERE id=$1 AND password_hash=$3 RETURNING auth_epoch",
        [sessionUser.id, newHash, row.password_hash],
      );
      if (!r.rowCount) return null;
      await c.query("DELETE FROM sessions WHERE user_id=$1", [sessionUser.id]);
      await c.query(
        "UPDATE device_challenges SET status='denied' WHERE user_id=$1 AND status IN ('pending','approved')",
        [sessionUser.id],
      );
      await c.query(
        "DELETE FROM email_tokens WHERE user_id=$1 AND purpose='reset_password'",
        [sessionUser.id],
      );
      await securityEvent(sessionUser.id, "password_changed", req.ip, c);
      return r.rows[0];
    });
    if (!changed)
      return reply
        .code(409)
        .send({ error: "Password changed. Sign in again." });
    const ip = clientIp(req);
    const session = await createSession(sessionUser.id, {
      ip,
      userAgent: req.headers["user-agent"],
      deviceId: sessionUser.deviceId ?? undefined,
      authEpoch: changed.auth_epoch,
    });
    setSessionCookie(reply, session);
    return { ok: true };
  });

  // List the account's active sessions ("what's logged in right now"), so
  // the owner can spot anything unfamiliar. This is read-only and doesn't
  // reveal anything sensitive beyond what a valid session already implies,
  // so unlike the destructive session/passkey actions it does NOT require
  // requireRecentAuth — a 6-day-old-but-still-valid session should still be
  // able to see this list without being forced to re-authenticate first.
  app.get("/v1/me/sessions", async (req, reply) => {
    const sessionUser = await requireUser(req, reply);
    if (!sessionUser) return;

    const sessions = await listSessions(sessionUser.id);
    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        reauthenticatedAt: s.reauthenticatedAt,
        userAgent: s.userAgent,
        isCurrent: s.id === sessionUser.sessionId,
      })),
    };
  });

  // Revoke one session by id. Scoped to the caller's own sessions inside
  // destroySessionById, so you can't pass another user's session id.
  // Revoking your own current session behaves like logging out.
  app.delete("/v1/me/sessions/:id", async (req, reply) => {
    const sessionUser = await requireUser(req, reply);
    if (!sessionUser) return;

    if (!(await requireRecentAuth(sessionUser, reply))) return;
    if (!(await rateLimitOr429(reply, "accountChange", sessionUser.id))) return;

    const { id } = req.params as { id: string };
    await securityEvent(sessionUser.id, "session_revoked", req.ip);
    const deleted = await destroySessionById(sessionUser.id, id);
    if (!deleted) return reply.code(404).send({ error: "Session not found." });
    if (id === sessionUser.sessionId) {
      clearSessionCookie(reply);
    }
    return { ok: true };
  });

  // "Log out of all other devices" — keeps the session making the request.
  app.post("/v1/me/sessions/revoke-others", async (req, reply) => {
    const sessionUser = await requireUser(req, reply);
    if (!sessionUser) return;

    if (!(await requireRecentAuth(sessionUser, reply))) return;
    if (!(await rateLimitOr429(reply, "accountChange", sessionUser.id))) return;

    await securityEvent(sessionUser.id, "other_sessions_revoked", req.ip);
    const revoked = await destroyOtherSessions(
      sessionUser.id,
      sessionUser.sessionId,
    );
    return { ok: true, revoked };
  });

  // Permanently deletes the account. Cascades in the schema (ON DELETE
  // CASCADE on addresses, sessions, email_tokens, webauthn_credentials)
  // take care of everything else tied to the user row.
  //
  // Gated harder than anything else in the API: the session must be
  // freshly authenticated (requireRecentAuth), AND, if the account has a
  // password, that password must be re-entered in the request body.
  // Passwordless (webauthn-only) accounts skip the password check since
  // there's nothing to check — requireRecentAuth is their proof instead.
  app.delete("/v1/me", async (req, reply) => {
    const sessionUser = await requireUser(req, reply);
    if (!sessionUser) return;

    if (!(await rateLimitOr429(reply, "accountDelete", sessionUser.id))) return;

    const found = await pool.query<{ password_hash: string | null }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [sessionUser.id],
    );
    const row = found.rows[0];

    if (!row) return reply.code(404).send({ error: "Not found." });

    if (row.password_hash) {
      const parsed = AccountDeleteInput.safeParse(req.body);

      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid request.",
          details: parsed.error.flatten(),
        });
      }

      const passwordOk = await verifyPassword(
        row.password_hash,
        parsed.data.password,
      );

      if (!passwordOk) {
        return reply.code(401).send({
          error: "Current password is incorrect.",
        });
      }
    } else if (!(await requireRecentAuth(sessionUser, reply))) return;

    await transaction(async (c) => {
      const owner = (
        await c.query(
          "SELECT email,password_hash FROM users WHERE id=$1 FOR UPDATE",
          [sessionUser.id],
        )
      ).rows[0];
      if (!owner || owner.password_hash !== row.password_hash)
        throw Object.assign(new Error("Credentials changed. Try again."), {
          statusCode: 409,
        });
      await deliverDevOrLogEmail(
        {
          to: owner.email,
          subject: "Your Chix account was deleted",
          body: `Account deletion completed at ${new Date().toISOString()}.`,
        },
        c,
        `account-deleted:${sessionUser.id}`,
      );
      await c.query(
        "UPDATE notification_outbox SET expires_at=now()+interval '30 days' WHERE dedupe_key=$1",
        [`account-deleted:${sessionUser.id}`],
      );
      await c.query("DELETE FROM users WHERE id=$1", [sessionUser.id]);
    });
    clearSessionCookie(reply);

    return { ok: true };
  });

  app.post("/v1/auth/verify-email", async (req, reply) => {
    const parsed = VerifyEmailInput.safeParse(req.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request.",
        details: parsed.error.flatten(),
      });
    }

    const { token } = parsed.data;

    const registration = await transaction(async (c) => {
      const { user } = await consumeEmailToken(
        c,
        parsed.data.token,
        "verify_email",
      );
      await c.query(
        "UPDATE users SET email_verified_at=now(),registration_pending=false,registration_trust_device=false,updated_at=now() WHERE id=$1",
        [user.id],
      );
      await securityEvent(user.id, "email_verified", req.ip, c);
      return user.registration_pending ? user : null;
    });
    if (registration) {
      try {
        await completeSignIn(req,reply,registration.id,"registration",registration.registration_trust_device,registration.auth_epoch);
      } catch {
        req.log.warn({requestId:req.id},"Email verified; first sign-in bootstrap failed");
        clearSessionCookie(reply);
        return {ok:true,signInRequired:true,message:"Your email is verified. Sign in to continue."};
      }
    }
    return { ok: true };
  });

  app.post("/v1/auth/verify-email/resend", async (req, reply) => {
    const sessionUser = await requireUser(req, reply);
    if (!sessionUser) return;

    const body = z.strictObject({captchaToken:z.string().max(4096).optional()}).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({error:"Invalid input."});
    await recoveryProtection("verification_resend",sessionUser.id,req.ip,body.data.captchaToken);

    const found = await pool.query<{
      email: string;
      email_verified_at: Date | null;
    }>(
      `SELECT email, email_verified_at
         FROM users
        WHERE id = $1`,
      [sessionUser.id],
    );

    const row = found.rows[0];

    if (!row) {
      return reply.code(404).send({ error: "Not found." });
    }

    if (row.email_verified_at) {
      return {
        ok: true,
        alreadyVerified: true,
      };
    }

    await transaction(async (c) => {
      const current = (
        await c.query("SELECT email FROM users WHERE id=$1 FOR UPDATE", [
          sessionUser.id,
        ])
      ).rows[0];
      await issueEmailToken(c, sessionUser.id, "verify_email", current.email);
    });
    return { ok: true };
  });

  app.post("/v1/auth/password-reset/request", async (req, reply) => {
    const parsed = PasswordResetRequestInput.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid input." });
    const { email, captchaToken } = parsed.data;
    await recoveryProtection("password_reset", email, req.ip, captchaToken);
    await transaction(async (c) => {
      const users = (
        await c.query(
          "SELECT * FROM users WHERE (email=$1 OR (recovery_email=$1 AND recovery_verified_at IS NOT NULL)) AND suspended_at IS NULL ORDER BY id LIMIT 5 FOR UPDATE",
          [email],
        )
      ).rows;
      for (const user of users)
        await issueEmailToken(
          c,
          user.id,
          "reset_password",
          email,
          user.email.toLowerCase() === email ? "primary" : "recovery",
        );
    });
    return {
      ok: true,
      message: "If an account matches, a recovery link will be sent.",
    };
  });

  app.post("/v1/auth/password-reset/confirm", async (req, reply) => {
    const ip = clientIp(req);

    if (!(await rateLimitOr429(reply, "passwordReset", ip))) return;

    const parsed = PasswordResetConfirmInput.safeParse(req.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid input.",
      });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const reset = await transaction(async (client) => {
      const { token, user } = await consumeEmailToken(
        client,
        parsed.data.token,
        "reset_password",
      );
      const userId = user.id;
      await client.query(
        "UPDATE users SET auth_epoch=auth_epoch+1,password_hash=$2,email_verified_at=CASE WHEN $3='primary' THEN coalesce(email_verified_at,now()) ELSE email_verified_at END,failed_login_count=0,locked_until=NULL,updated_at=now() WHERE id=$1",
        [userId, passwordHash, token.channel],
      );
      await client.query(
        "UPDATE email_tokens SET used_at=now() WHERE user_id=$1 AND purpose IN ('reset_password','change_email') AND used_at IS NULL",
        [userId],
      );
      await client.query("DELETE FROM sessions WHERE user_id=$1", [userId]);
      await client.query(
        "UPDATE trusted_devices SET revoked_at=now() WHERE user_id=$1",
        [userId],
      );
      await client.query("DELETE FROM recovery_codes WHERE user_id=$1", [
        userId,
      ]);
      await client.query(
        "UPDATE device_challenges SET status='denied' WHERE user_id=$1 AND status IN ('pending','approved')",
        [userId],
      );
      await securityEvent(userId, "password_reset", req.ip, client);
      return true;
    });
    if (!reset)
      return reply.code(400).send({ error: "Invalid or expired token." });

    return { ok: true };
  });
}
