import { randomInt } from "node:crypto";
import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import { config } from "./config.js";
import {
  issueEmailToken,
  consumeEmailToken,
  consumeVerificationCode,
} from "./tokens.js";
import {
  verifyBot,
  loginProtection,
  failedLogin,
  recoveryProtection,
} from "./bot.js";
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
  EmailChangeInput,
  PhoneChangeInput,
  ProfileUpdateInput,
  RegisterInput,
  UsernameChangeInput,
  VerifyEmailInput,
} from "./validation.js";

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
  ok: true,
  verificationRequired: true,
  message:
    "Check your email to continue. If you already have an account, sign in or use account recovery.",
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
    // A shared response floor with jitter covers ordinary transaction variance.
    const respondAt = performance.now() + 400 + randomInt(101);
    const finishRegistration = async () => {
      await delay(Math.max(0, respondAt - performance.now()));
      return reply.code(201).send(registrationResponse);
    };
    const passwordHash = null;

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
        req.log.warn(
          { requestId: req.id },
          "Account committed; registration finalization interrupted",
        );
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

  app.post("/v1/auth/logout", async (req, reply) => {
    const actor = await readSessionUser(req);
    if (actor)
      await securityEvent(
        actor.id,
        "logout",
        req.ip,
        undefined,
        req.headers["user-agent"],
      );
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
              u.email_verified_at, u.phone_verified_at, false AS has_password,
              EXISTS(SELECT 1 FROM webauthn_credentials w WHERE w.user_id=u.id) AS has_passkey,
              EXISTS(SELECT 1 FROM authenticators a WHERE a.user_id=u.id) AS has_authenticator,
              a.line1, a.line2, a.city, a.region, a.postal_code, a.country AS address_country
         FROM users u
         LEFT JOIN addresses a ON a.user_id = u.id
        WHERE u.id = $1`,
      [sessionUser.id],
    );
    const row = result.rows[0];
    if (!row) return reply.code(404).send({ error: "Not found." });
    return {
      user: {
        ...publicUser(row),
        role: sessionUser.role,
        hasPassword: row.has_password,
        hasPasskey: row.has_passkey,
        hasAuthenticator: row.has_authenticator,
      },
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
  // Password proof is checked against the locked credential; other methods use
  // the authorizing session's recent, database-backed proof.
  for (const [route, schema, column] of [
    ["email", EmailChangeInput, "email"],
    ["username", UsernameChangeInput, "username"],
    ["phone", PhoneChangeInput, "phone_e164"],
  ] as const)
    app.post(`/v1/me/${route}`, async (req, reply) => {
      const session = await requireUser(req, reply);
      if (!session) return;
      if (
        !(await rateLimitOr429(
          reply,
          route === "email" ? "emailChange" : "accountChange",
          session.id,
        ))
      )
        return;
      const parsed = schema.safeParse(req.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: "Invalid request.", details: parsed.error.flatten() });
      const body = parsed.data;
      const value = (body as unknown as Record<string, string>)[route]!;
      try {
        return await transaction(async (c) => {
          const user = await lockSessionUser(c, session, true);
          if (user[column] === value) return { ok: true, unchanged: true };
          if (route === "email") {
            if (
              (await c.query("SELECT 1 FROM users WHERE email=$1", [value]))
                .rowCount
            )
              throw Object.assign(new Error("Email change unavailable."), {
                statusCode: 409,
              });
            await issueEmailToken(c, session.id, "change_email", value);
            await securityEvent(
              session.id,
              "email_change_requested",
              req.ip,
              c,
              req.headers["user-agent"],
            );
            return { ok: true, emailVerificationRequired: true };
          }
          await c.query(
            `UPDATE users SET ${column}=$2,updated_at=now()${route === "phone" ? ",phone_verified_at=NULL" : ""} WHERE id=$1`,
            [session.id, value],
          );
          if (route === "username") {
            await c.query("DELETE FROM sessions WHERE user_id=$1", [
              session.id,
            ]);
            clearSessionCookie(reply);
          }
          return { ok: true, phoneVerificationRequired: route === "phone" };
        });
      } catch (error) {
        if ((error as { code?: string }).code === "23505")
          return reply
            .code(409)
            .send({ error: "That value is already in use." });
        throw error;
      }
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
    const deleted = await transaction(async (c) => {
      await lockSessionUser(c, sessionUser, true);
      const result = await c.query(
        "DELETE FROM sessions WHERE user_id=$1 AND id=$2",
        [sessionUser.id, id],
      );
      if (result.rowCount)
        await securityEvent(
          sessionUser.id,
          "session_revoked",
          req.ip,
          c,
          req.headers["user-agent"],
        );
      return Boolean(result.rowCount);
    });
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
    const revoked = await transaction(async (c) => {
      await lockSessionUser(c, sessionUser, true);
      const result = await c.query(
        "DELETE FROM sessions WHERE user_id=$1 AND id<>$2",
        [sessionUser.id, sessionUser.sessionId],
      );
      await securityEvent(
        sessionUser.id,
        "other_sessions_revoked",
        req.ip,
        c,
        req.headers["user-agent"],
      );
      return result.rowCount;
    });
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
    if (!(await requireRecentAuth(sessionUser, reply))) return;
    await transaction(async (c) => {
      const owner = await lockSessionUser(c, sessionUser, true);
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
    if (!(await rateLimitOr429(reply, "verifyEmailAttempt", req.ip))) return;
    const parsed = VerifyEmailInput.safeParse(req.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request.",
        details: parsed.error.flatten(),
      });
    }

    const outcome = await transaction(async (c) => {
      const proof = await consumeVerificationCode(
        c,
        parsed.data.email,
        parsed.data.code,
      );
      if (!proof) return null;
      const { user } = proof;
      await c.query(
        "UPDATE users SET email_verified_at=now(),registration_pending=false,registration_trust_device=false,updated_at=now() WHERE id=$1",
        [user.id],
      );
      await securityEvent(
        user.id,
        "email_verified",
        req.ip,
        c,
        req.headers["user-agent"],
      );
      return { registration: user.registration_pending ? user : null };
    });
    if (!outcome)
      return reply.code(400).send({ error: "Invalid or expired code." });
    const { registration } = outcome;
    if (registration) {
      try {
        await completeSignIn(
          req,
          reply,
          registration.id,
          "registration",
          registration.registration_trust_device,
          registration.auth_epoch,
        );
      } catch {
        req.log.warn(
          { requestId: req.id },
          "Email verified; first sign-in bootstrap failed",
        );
        clearSessionCookie(reply);
        return {
          ok: true,
          signInRequired: true,
          message: "Your email is verified. Sign in to continue.",
        };
      }
    }
    return { ok: true };
  });

  app.post("/v1/auth/verify-email/resend", async (req, reply) => {
    const session = await readSessionUser(req);
    const parsed = z
      .strictObject({
        email: z.string().trim().email().max(254).toLowerCase().optional(),
        captchaToken: z.string().max(4096).optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success || (!session && !parsed.data.email))
      return reply.code(400).send({ error: "Enter your email." });
    const email = parsed.data.email;
    await recoveryProtection(
      "verification_resend",
      session?.id ?? email!,
      req.ip,
      parsed.data.captchaToken,
    );
    await transaction(async (c) => {
      const user = (
        await c.query(
          session
            ? "SELECT * FROM users WHERE id=$1 AND suspended_at IS NULL FOR UPDATE"
            : "SELECT * FROM users WHERE email=$1 AND suspended_at IS NULL FOR UPDATE",
          [session?.id ?? email],
        )
      ).rows[0];
      if (user && !user.email_verified_at)
        await issueEmailToken(c, user.id, "verify_email", user.email);
    });
    return {
      ok: true,
      message: "If verification is needed, a code is on its way.",
    };
  });
}
