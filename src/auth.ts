import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { pool } from "./db.js";
import {
  deliverDevOrLogEmail,
  sendAdminAccountCreatedNotification,
} from "./mail.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { buckets, clientIp, consumeRateLimit } from "./rateLimit.js";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  consumeOneTimeToken,
  createOneTimeToken,
  createSession,
  destroyAllSessions,
  destroyOtherSessions,
  destroySession,
  destroySessionById,
  listSessions,
  markSessionReauthenticated,
  readSessionUser,
  setSessionCookie,
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
    await reply.code(429).send({ error: "Too many requests. Try again later." });
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
export const STEP_UP_WINDOW_MS = 15 * 60 * 1000;

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

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/auth/register", async (req, reply) => {
    const ip = clientIp(req);
    if (!(await rateLimitOr429(reply, "signup", ip))) return;

    const parsed = RegisterInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input.", details: parsed.error.flatten() });
    }
    const body = parsed.data;
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
          body.phone,
          body.marketingAnnouncements,
          body.marketingApps,
        ],
      );
      const userRow = userInsert.rows[0]!;
      const userId = userRow.id;
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
      await client.query("COMMIT");
transactionCommitted = true;

try {
  await sendAdminAccountCreatedNotification({
    username: body.username,
    email: body.email,
    createdAt: userRow.created_at,
  });
} catch (err: unknown) {
  req.log.error(err, "Failed to deliver admin account-created notification");
}

const verifyToken = await createOneTimeToken(userId, "verify_email");

      try {
        await deliverDevOrLogEmail({
          to: body.email,
          subject: "Verify your Chalkline email",
          body: `Verification token (dev only): ${verifyToken}`,
        });
      } catch (err: unknown) {
        // The account has already been committed successfully.
        // Do not report registration as failed just because the email
        // provider is temporarily unavailable. Log the infrastructure
        // failure without exposing the verification token.
        req.log.error(err, "Failed to deliver verification email");
      }

      const session = await createSession(userId, {
        ip,
        userAgent: req.headers["user-agent"],
      });

      setSessionCookie(reply, session);
      return reply.code(201).send({
        user: {
          id: userId,
          email: body.email,
          username: body.username,
          firstName: body.firstName,
          lastName: body.lastName,
          country: body.country,
          emailVerified: false,
          phoneVerified: false,
        },
      });
    } catch (err: unknown) {
      if (!transactionCommitted) {
        await client.query("ROLLBACK");
      }
      const code = typeof err === "object" && err && "code" in err ? String((err as { code: string }).code) : "";
      if (code === "23505") {
        return reply.code(409).send({ error: "An account with that email or username already exists." });
      }
      req.log.error(err);
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
    if (!(await rateLimitOr429(reply, "login", `${ip}:${parsed.data.email}`))) return;

    const found = await pool.query<{
      id: string;
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
      `SELECT id, password_hash, locked_until, email, username, first_name, last_name, country,
              email_verified_at, phone_verified_at
         FROM users WHERE email = $1`,
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

    if (!user || !user.password_hash) {
      return reply.code(401).send({ error: "Invalid email or password." });
    }

    if (user.locked_until && user.locked_until > new Date()) {
      return reply.code(401).send({ error: "Invalid email or password." });
    }

    if (!passwordOk) {
      await pool.query(
        `UPDATE users
            SET failed_login_count = failed_login_count + 1,
                locked_until = CASE
                  WHEN failed_login_count + 1 >= 5
                  THEN now() + interval '15 minutes'
                  ELSE locked_until
                END
          WHERE id = $1`,
        [user.id],
      );

      return reply.code(401).send({
        error: "Invalid email or password.",
      });
    }

    await pool.query(
      `UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1`,
      [user.id],
    );

    const session = await createSession(user.id, {
      ip,
      userAgent: req.headers["user-agent"],
    });

    setSessionCookie(reply, session);

    return { user: publicUser(user) };
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    const raw = req.cookies[SESSION_COOKIE];
    if (raw) await destroySession(raw);
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
         JOIN addresses a ON a.user_id = u.id
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
  app.get("/v1/me/export", async (req, reply) => {
    const sessionUser = await requireUser(req, reply);
    if (!sessionUser) return;

    if (!(await requireRecentAuth(sessionUser, reply))) return;

    const userResult = await pool.query<{
      id: string;
      email: string;
      email_verified_at: Date | null;
      username: string;
      first_name: string;
      last_name: string;
      country: string;
      date_of_birth: string;
      phone_e164: string | null;
      phone_verified_at: Date | null;
      marketing_announcements: boolean;
      marketing_apps: boolean;
      consents_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, email, email_verified_at, username, first_name, last_name,
              country, date_of_birth, phone_e164, phone_verified_at,
              marketing_announcements, marketing_apps, consents_at,
              created_at, updated_at
         FROM users
        WHERE id = $1`,
      [sessionUser.id],
    );

    const user = userResult.rows[0];
    if (!user) return reply.code(404).send({ error: "Not found." });

    const addressResult = await pool.query<{
      id: string;
      line1: string;
      line2: string | null;
      city: string;
      region: string | null;
      postal_code: string;
      country: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, line1, line2, city, region, postal_code, country,
              created_at, updated_at
         FROM addresses
        WHERE user_id = $1`,
      [sessionUser.id],
    );

    const sessionsResult = await pool.query<{
      id: string;
      expires_at: Date;
      created_at: Date;
      ip: string | null;
      user_agent: string | null;
      reauthenticated_at: Date;
    }>(
      `SELECT id, expires_at, created_at, ip, user_agent, reauthenticated_at
         FROM sessions
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [sessionUser.id],
    );

    const tokensResult = await pool.query<{
      id: string;
      purpose: string;
      expires_at: Date;
      used_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, purpose, expires_at, used_at, created_at
         FROM email_tokens
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [sessionUser.id],
    );

    const credentialsResult = await pool.query<{
      id: string;
      device_name: string | null;
      counter: string;
      created_at: Date;
    }>(
      `SELECT id, device_name, counter, created_at
         FROM webauthn_credentials
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [sessionUser.id],
    );

    return {
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        email: user.email,
        emailVerifiedAt: user.email_verified_at,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        country: user.country,
        dateOfBirth: user.date_of_birth,
        phone: user.phone_e164,
        phoneVerifiedAt: user.phone_verified_at,
        marketingAnnouncements: user.marketing_announcements,
        marketingApps: user.marketing_apps,
        consentsAt: user.consents_at,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
      address: addressResult.rows[0] ?? null,
      sessions: sessionsResult.rows,
      emailTokens: tokensResult.rows,
      webauthnCredentials: credentialsResult.rows,
    };
  });

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

    try {
      const updateResult = await pool.query(
        `UPDATE users
            SET email = $2,
                email_verified_at = NULL,
                updated_at = now()
          WHERE id = $1
            AND email = $3`,
        [sessionUser.id, email, row.email],
      );

      if ((updateResult.rowCount ?? 0) === 0) {
        return reply.code(409).send({
          error: "The account email changed. Please try again.",
        });
      }
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err && err.code === "23505") {
        return reply.code(409).send({
          error: "That email address is already in use.",
        });
      }

      throw err;
    }

    const token = await createOneTimeToken(sessionUser.id, "verify_email");

    // Invalidate all existing sessions immediately after the email change.
    await destroyAllSessions(sessionUser.id);
    clearSessionCookie(reply);

    try {
      await deliverDevOrLogEmail({
        to: email,
        subject: "Verify your Chalkline email",
        body: `Verification token (dev only): ${token}`,
      });
    } catch (err: unknown) {
      req.log.error(err, "Failed to deliver email-change verification email");
    }

    return {
      ok: true,
      emailVerificationRequired: true,
    };
  });

  app.patch("/v1/me", async (req, reply) => {
    const sessionUser = await requireUser(req, reply);
    if (!sessionUser) return;
    const parsed = ProfileUpdateInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input.", details: parsed.error.flatten() });
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
      if (err && typeof err === "object" && "code" in err && err.code === "23505") {
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
    if (!(await rateLimitOr429(reply, "passwordChange", sessionUser.id))) return;

    const parsed = PasswordChangeInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input.", details: parsed.error.flatten() });
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

    // Note: PasswordChangeInput's own superRefine already rejects
    // newPassword === currentPassword, so there's no need to re-check it
    // here — safeParse would have already failed with a 400 above.

    const newHash = await hashPassword(body.newPassword);
    await pool.query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [
      sessionUser.id,
      newHash,
    ]);

    // Rotate sessions: a changed password should invalidate any other logged-in
    // device/browser. Destroy everything, then re-issue a fresh session for the
    // request that just proved it knows the new password.
    await destroyAllSessions(sessionUser.id);
    const ip = clientIp(req);
    const session = await createSession(sessionUser.id, { ip, userAgent: req.headers["user-agent"] });
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
        ip: s.ip,
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

    const revoked = await destroyOtherSessions(sessionUser.id, sessionUser.sessionId);
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

      const passwordOk = await verifyPassword(row.password_hash, parsed.data.password);

      if (!passwordOk) {
        return reply.code(401).send({
          error: "Current password is incorrect.",
        });
      }
    }

    await pool.query(`DELETE FROM users WHERE id = $1`, [sessionUser.id]);
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

    const userId = await consumeOneTimeToken(token, "verify_email");

    if (!userId) {
      return reply.code(400).send({
        error: "Invalid or expired token.",
      });
    }

    await pool.query(
      `UPDATE users
          SET email_verified_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [userId],
    );

    return { ok: true };
  });

  app.post("/v1/auth/verify-email/resend", async (req, reply) => {
    const sessionUser = await requireUser(req, reply);
    if (!sessionUser) return;

    if (!(await rateLimitOr429(reply, "resendVerification", sessionUser.id))) {
      return;
    }

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

    const token = await createOneTimeToken(sessionUser.id, "verify_email");

    await deliverDevOrLogEmail({
      to: row.email,
      subject: "Verify your Chalkline email",
      body: `Verification token (dev only): ${token}`,
    });

    return { ok: true };
  });

  app.post("/v1/auth/password-reset/request", async (req, reply) => {
    const ip = clientIp(req);

    if (!(await rateLimitOr429(reply, "passwordReset", ip))) return;

    const parsed = PasswordResetRequestInput.safeParse(req.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid input.",
      });
    }

    const { email } = parsed.data;

    const found = await pool.query<{ id: string; email: string }>(
      `SELECT id, email
         FROM users
        WHERE email = $1`,
      [email],
    );

    const user = found.rows[0];

    // Always return the same response whether the account exists or not.
    // This prevents email-account enumeration.
    if (!user) {
      return {
        ok: true,
        message: "If an account exists for that email, a reset token has been sent.",
      };
    }

    const token = await createOneTimeToken(user.id, "reset_password");

    await deliverDevOrLogEmail({
      to: user.email,
      subject: "Reset your Chalkline password",
      body: `Password reset token (dev only): ${token}`,
    });

    return {
      ok: true,
      message: "If an account exists for that email, a reset token has been sent.",
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

    const userId = await consumeOneTimeToken(parsed.data.token, "reset_password");

    if (!userId) {
      return reply.code(400).send({
        error: "Invalid or expired token.",
      });
    }

    const passwordHash = await hashPassword(parsed.data.password);

    await pool.query(
      `UPDATE users
          SET password_hash = $2,
              failed_login_count = 0,
              locked_until = NULL,
              updated_at = now()
        WHERE id = $1`,
      [userId, passwordHash],
    );

    // A password reset invalidates every existing session.
    await destroyAllSessions(userId);

    return { ok: true };
  });
}