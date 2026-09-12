import { issueEmailToken } from "./tokens.js";
import { transaction } from "./transactions.js";
import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { failure } from "./http.js";
import { config, isProd } from "./config.js";
import { pool } from "./db.js";

export const SESSION_COOKIE = "chalkline_session";
export type CreatedSession = { token: string; expiresAt: Date };
// One predicate for authentication and the account's active-session list.
const validSession = `s.expires_at > now() AND s.auth_epoch=u.auth_epoch
  AND u.suspended_at IS NULL
  AND s.last_active_at + s.idle_seconds * interval '1 second' > now()
  AND (s.device_id IS NULL OR EXISTS(SELECT 1 FROM trusted_devices d
    WHERE d.id=s.device_id AND d.user_id=s.user_id
      AND d.revoked_at IS NULL AND d.expires_at>now()))`;
// Host-only cookie: deliberately omit Domain. Deletion must share this scope.
const sessionCookieOptions = {
  httpOnly: true,
  secure: config.COOKIE_SECURE || isProd,
  sameSite: "strict" as const,
  path: "/",
};

export function hashToken(raw: Buffer | string): Buffer {
  return createHash("sha256").update(raw).digest();
}

export async function createSession(
  userId: string,
  meta: {
    ip?: string;
    userAgent?: string;
    deviceId?: string;
    authEpoch?: number;
    authMethod?: "password" | "passkey";
  },
  client: PoolClient | typeof pool = pool,
): Promise<CreatedSession> {
  const raw = randomBytes(32).toString("base64url");
  const inserted = await client.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent, device_id, auth_epoch,idle_seconds,auth_method)
     SELECT id, $2, now()+(CASE WHEN $6::uuid IS NULL THEN 1 ELSE session_days END * interval '1 day'), $4::inet, $5, $6, auth_epoch,
       CASE WHEN $6::uuid IS NULL THEN 43200 ELSE least(session_days,$3::int)*86400 END,$8 FROM users WHERE id=$1 AND suspended_at IS NULL AND NOT registration_pending AND ($7::int IS NULL OR auth_epoch=$7) RETURNING expires_at`,
    [
      userId,
      hashToken(raw),
      config.SESSION_IDLE_MAX_DAYS,
      meta.ip ?? null,
      meta.userAgent?.slice(0, 200) ?? null,
      meta.deviceId ?? null,
      meta.authEpoch ?? null,
      meta.authMethod ?? "password",
    ],
  );
  if (!inserted.rowCount)
    throw Object.assign(new Error("Credentials changed. Sign in again."), {
      statusCode: 401,
    });
  return { token: raw, expiresAt: inserted.rows[0].expires_at };
}

export function setSessionCookie(
  reply: FastifyReply,
  session: CreatedSession,
): void {
  reply.setCookie(SESSION_COOKIE, session.token, {
    ...sessionCookieOptions,
    expires: session.expiresAt,
    maxAge: Math.max(
      0,
      Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
    ),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, sessionCookieOptions);
}

// A Cookie header omits Path/Domain and may contain several same-name cookies.
// Preserve every token for logout instead of trusting the parser's first match.
export function sessionTokens(req: FastifyRequest): string[] {
  return [
    ...new Set(
      (req.headers.cookie ?? "")
        .split(";")
        .map((part) => req.server.parseCookie(part)[SESSION_COOKIE])
        .filter((token): token is string => Boolean(token)),
    ),
  ];
}

export type UserRole = "user" | "admin";

export type SessionUser = {
  id: string;
  sessionId: string;
  deviceId: string | null;
  reauthenticatedAt: Date;
  role: UserRole;
  authMethod: "password" | "passkey";
};

// Security mutations lock the owner first, then revalidate the authorizing
// session. This serializes them with reset, email changes and suspension.
export async function lockSessionUser(c: PoolClient, session: SessionUser, recent = false) {
  const user = (await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [session.id])).rows[0];
  if (!user) throw failure(401,"Session expired. Sign in again.");
  const valid = await c.query(
    `SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.id=$1 AND s.user_id=$2 AND ${validSession}
     AND (NOT $3::boolean OR s.reauthenticated_at > now()-interval '10 minutes')`,
    [session.sessionId,session.id,recent],
  );
  if (!valid.rowCount) throw failure(401,"Session expired or confirmation required. Sign in again.");
  return user;
}

export async function readSessionUser(
  req: FastifyRequest,
): Promise<SessionUser | null> {
  const tokens = sessionTokens(req);
  if (!tokens.length) return null;
  const result = await pool.query<{
    id: string;
    session_id: string;
    device_id: string | null;
    reauthenticated_at: Date;
    role: UserRole;
    auth_method: "password" | "passkey";
  }>(
    `SELECT u.id, s.id AS session_id, s.reauthenticated_at, s.device_id, u.role, s.auth_method
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ANY($1::bytea[])
        AND ${validSession}`,
    [tokens.map(hashToken)],
  );
  // Ignore revoked legacy cookies, but never choose between two valid sessions.
  if (result.rows.length !== 1) return null;
  const row = result.rows[0];
  if (!row) return null;
  await pool.query(
    "UPDATE sessions SET last_active_at=now() WHERE id=$1 AND last_active_at<now()-interval '5 minutes'",
    [row.session_id],
  );
  return {
    id: row.id,
    sessionId: row.session_id,
    deviceId: row.device_id,
    reauthenticatedAt: row.reauthenticated_at,
    role: row.role as UserRole,
    authMethod: row.auth_method,
  };
}

export async function destroySession(
  rawToken: string,
  ...otherTokens: string[]
): Promise<void> {
  await pool.query(`DELETE FROM sessions WHERE token_hash = ANY($1::bytea[])`, [
    [rawToken, ...otherTokens].map(hashToken),
  ]);
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
    user_agent: string | null;
  }>(
    `SELECT s.id, s.created_at, s.expires_at, s.reauthenticated_at, s.user_agent
       FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.user_id = $1 AND ${validSession}
      ORDER BY s.created_at DESC`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    reauthenticatedAt: row.reauthenticated_at,
    userAgent: row.user_agent,
  }));
}

// Deletes one session, scoped to the owning user so you can't revoke a
// session id that isn't yours just by guessing/enumerating uuids. Returns
// whether a row was actually deleted.
export async function destroySessionById(
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

// Signs out every session for a user except the one making the request —
// the "log out of all other devices" action.
export async function destroyOtherSessions(
  userId: string,
  keepSessionId: string,
): Promise<number> {
  const result = await pool.query(
    `DELETE FROM sessions WHERE user_id = $1 AND id != $2`,
    [userId, keepSessionId],
  );
  return result.rowCount ?? 0;
}

export async function createOneTimeToken(
  userId: string,
  purpose: "verify_email" | "reset_password",
  expectedEmail?: string,
): Promise<string> {
  return transaction(async (c) => {
    const user = (
      await c.query("SELECT email FROM users WHERE id=$1 FOR UPDATE", [userId])
    ).rows[0];
    if (
      !user ||
      (expectedEmail &&
        user.email.toLowerCase() !== expectedEmail.toLowerCase())
    )
      throw new Error("Account changed.");
    return issueEmailToken(c, userId, purpose, user.email);
  });
}
