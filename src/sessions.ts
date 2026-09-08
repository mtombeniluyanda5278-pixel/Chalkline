import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config, isProd } from "./config.js";
import { pool } from "./db.js";

export const SESSION_COOKIE = "chalkline_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashToken(raw: Buffer | string): Buffer {
  return createHash("sha256").update(raw).digest();
}

export async function createSession(
  userId: string,
  meta: { ip?: string; userAgent?: string },
): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4::inet, $5)`,
    [userId, hashToken(raw), expiresAt, meta.ip ?? null, meta.userAgent ?? null],
  );
  return raw;
}

export function setSessionCookie(reply: FastifyReply, rawToken: string): void {
  reply.setCookie(SESSION_COOKIE, rawToken, {
    httpOnly: true,
    secure: config.COOKIE_SECURE || isProd,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export type UserRole = "user" | "admin";

export type SessionUser = {
  id: string;
  sessionId: string;
  reauthenticatedAt: Date;
  role: UserRole;
};

export async function readSessionUser(req: FastifyRequest): Promise<SessionUser | null> {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const result = await pool.query<{
  id: string;
  session_id: string;
  reauthenticated_at: Date;
  role: UserRole;
}>(
    `SELECT u.id, s.id AS session_id, s.reauthenticated_at, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > now()`,
    [hashToken(raw)],
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    sessionId: row.session_id,
    reauthenticatedAt: row.reauthenticated_at,
    role: row.role as UserRole,
  };
}

export async function destroySession(rawToken: string): Promise<void> {
  await pool.query(
    `DELETE FROM sessions WHERE token_hash = $1`,
    [hashToken(rawToken)],
  );
}

export async function markSessionReauthenticated(
  sessionId: string,
): Promise<void> {
  await pool.query(
    `UPDATE sessions
        SET reauthenticated_at = now()
      WHERE id = $1`,
    [sessionId],
  );
}

export async function destroyAllSessions(userId: string): Promise<void> {
  await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}

export type SessionSummary = {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  reauthenticatedAt: Date;
  ip: string | null;
  userAgent: string | null;
};

// Lists a user's active (non-expired) sessions, newest first, so the
// account owner can see "what's logged in right now" and spot anything
// that isn't them.
export async function listSessions(userId: string): Promise<SessionSummary[]> {
  const result = await pool.query<{
    id: string;
    created_at: Date;
    expires_at: Date;
    reauthenticated_at: Date;
    ip: string | null;
    user_agent: string | null;
  }>(
    `SELECT id, created_at, expires_at, reauthenticated_at, ip, user_agent
       FROM sessions
      WHERE user_id = $1
        AND expires_at > now()
      ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    reauthenticatedAt: row.reauthenticated_at,
    ip: row.ip,
    userAgent: row.user_agent,
  }));
}

// Deletes one session, scoped to the owning user so you can't revoke a
// session id that isn't yours just by guessing/enumerating uuids. Returns
// whether a row was actually deleted.
export async function destroySessionById(userId: string, sessionId: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM sessions WHERE id = $1 AND user_id = $2`, [sessionId, userId]);
  return (result.rowCount ?? 0) > 0;
}

// Signs out every session for a user except the one making the request —
// the "log out of all other devices" action.
export async function destroyOtherSessions(userId: string, keepSessionId: string): Promise<number> {
  const result = await pool.query(`DELETE FROM sessions WHERE user_id = $1 AND id != $2`, [userId, keepSessionId]);
  return result.rowCount ?? 0;
}

export async function createOneTimeToken(
  userId: string,
  purpose: "verify_email" | "reset_password",
): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  const ttlMs =
    purpose === "reset_password"
      ? 30 * 60 * 1000
      : 24 * 60 * 60 * 1000;

  // Only the newest token for a given purpose remains valid.
  // This prevents old reset/verification links from remaining usable
  // after a newer one has been issued.
  await pool.query(
    `UPDATE email_tokens
        SET used_at = now()
      WHERE user_id = $1
        AND purpose = $2
        AND used_at IS NULL`,
    [userId, purpose],
  );

  await pool.query(
    `INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [
      userId,
      purpose,
      hashToken(raw),
      new Date(Date.now() + ttlMs),
    ],
  );

  return raw;
}

export async function consumeOneTimeToken(
  raw: string,
  purpose: "verify_email" | "reset_password",
): Promise<string | null> {
  const result = await pool.query<{ user_id: string; id: string }>(
    `UPDATE email_tokens
        SET used_at = now()
      WHERE token_hash = $1
        AND purpose = $2
        AND used_at IS NULL
        AND expires_at > now()
      RETURNING user_id, id`,
    [hashToken(raw), purpose],
  );
  return result.rows[0]?.user_id ?? null;
}