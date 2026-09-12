import { transaction } from "./transactions.js";
import { failure } from "./http.js";
import { completeSignIn } from "./devices.js";
import { securityEvent } from "./security.js";
import type { FastifyInstance } from "fastify";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { z } from "zod";

import { config } from "./config.js";
import { pool } from "./db.js";
import { requireRecentAuth, requireUser } from "./auth.js";
import { createSession, setSessionCookie } from "./sessions.js";
import { clientIp, consumeRateLimit, redis } from "./rateLimit.js";

const WebAuthnRegistrationResponseSchema = z.strictObject({
  id: z.string().min(1),
  rawId: z.string().min(1),
  response: z.strictObject({
    clientDataJSON: z.string().min(1),
    attestationObject: z.string().min(1),
  }),
  type: z.literal("public-key"),
  deviceName: z.unknown().optional(),
});

const WebAuthnAuthenticationResponseSchema = z.strictObject({
  id: z.string().min(1),
  rawId: z.string().min(1),
  response: z.strictObject({
    clientDataJSON: z.string().min(1),
    authenticatorData: z.string().min(1),
    signature: z.string().min(1),
    userHandle: z.string().optional(),
  }),
  type: z.literal("public-key"),
});

const LOGIN_CHALLENGE_COOKIE = "chalkline_webauthn";

const CHALLENGE_TTL_SECONDS = 5 * 60;

export async function putChallenge(
  key: string,
  challenge: string,
): Promise<void> {
  if (redis.status !== "ready") {
    await redis.connect();
  }

  await redis.set(
    `webauthn:challenge:${key}`,
    challenge,
    "EX",
    CHALLENGE_TTL_SECONDS,
  );
}

export async function takeChallenge(key: string): Promise<string | null> {
  if (redis.status !== "ready") {
    await redis.connect();
  }

  return redis.getdel(`webauthn:challenge:${key}`);
}

export async function registerWebAuthnRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ---------------------------------------------------------------------------
  // PASSKEY REGISTRATION — OPTIONS
  // ---------------------------------------------------------------------------

  app.post("/v1/auth/passkeys/register/options", async (req, reply) => {
    const sessionUser = await requireUser(req, reply);
    if (!sessionUser) return;

    if (!(await consumeRateLimit("webauthn", sessionUser.id)).allowed) {
      return reply
        .code(429)
        .send({ error: "Too many requests. Try again later." });
    }

    // Registering a passkey creates a durable, password-free way to log in.
    // A merely-valid session can be up to 7 days old, so require recent
    // authentication before issuing registration options.
    if (!(await requireRecentAuth(sessionUser, reply))) return;

    const user = await pool.query<{
      email: string;
      username: string;
    }>(
      `SELECT email, username
         FROM users
        WHERE id = $1`,
      [sessionUser.id],
    );

    const row = user.rows[0];
    if (!row) {
      return reply.code(404).send({ error: "Not found." });
    }

    const existing = await pool.query<{ credential_id: Buffer }>(
      `SELECT credential_id
         FROM webauthn_credentials
        WHERE user_id = $1`,
      [sessionUser.id],
    );

    const options = await generateRegistrationOptions({
      rpName: config.WEBAUTHN_RP_NAME,
      rpID: config.WEBAUTHN_RP_ID,
      userName: row.email,
      userDisplayName: row.username,
      userID: new TextEncoder().encode(sessionUser.id),
      attestationType: "none",
      excludeCredentials: existing.rows.map((c) => ({
        id: c.credential_id.toString("base64url"),
        type: "public-key" as const,
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
    });

    await putChallenge(`reg:${sessionUser.sessionId}`, options.challenge);

    return options;
  });

  // ---------------------------------------------------------------------------
  // PASSKEY REGISTRATION — VERIFY
  // ---------------------------------------------------------------------------

  app.post("/v1/auth/passkeys/register/verify", async (req, reply) => {
    const sessionUser = await requireUser(req, reply);
    if (!sessionUser) return;

    if (!(await consumeRateLimit("webauthn", sessionUser.id)).allowed) {
      return reply
        .code(429)
        .send({ error: "Too many requests. Try again later." });
    }

    // Re-check recent authentication here as well. The verification endpoint
    // is the operation that actually creates the durable credential.
    if (!(await requireRecentAuth(sessionUser, reply))) return;

    const expectedChallenge = await takeChallenge(
      `reg:${sessionUser.sessionId}`,
    );

    if (!expectedChallenge) {
      return reply.code(400).send({ error: "Challenge expired. Start again." });
    }

    const parsedBody = WebAuthnRegistrationResponseSchema.safeParse(req.body);

    if (!parsedBody.success) {
      return reply.code(400).send({
        error: "Invalid passkey response.",
      });
    }

    const body = parsedBody.data as RegistrationResponseJSON & {
      deviceName?: unknown;
    };

    let deviceName: string | null = null;

    if (typeof body.deviceName === "string") {
      const trimmed = body.deviceName.trim();

      if (trimmed.length > 100) {
        return reply.code(400).send({ error: "Device name is too long." });
      }

      deviceName = trimmed || null;
    }

    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: config.WEBAUTHN_ORIGIN,
      expectedRPID: config.WEBAUTHN_RP_ID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return reply.code(400).send({ error: "Passkey could not be verified." });
    }

    const info = verification.registrationInfo;

    try {
      await pool.query(
        `INSERT INTO webauthn_credentials
          (user_id, credential_id, public_key, counter, device_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          sessionUser.id,
          Buffer.from(info.credential.id, "base64url"),
          Buffer.from(info.credential.publicKey),
          info.credential.counter,
          deviceName,
        ],
      );
    } catch (error: unknown) {
      // credential_id is UNIQUE, so don't expose database details to clients.
      const message = error instanceof Error ? error.message.toLowerCase() : "";

      if (
        message.includes("duplicate") ||
        message.includes("unique") ||
        message.includes("credential_id")
      ) {
        return reply
          .code(409)
          .send({ error: "This passkey is already registered." });
      }

      throw error;
    }

    await securityEvent(sessionUser.id, "passkey_added", req.ip);
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // LIST PASSKEYS
  // ---------------------------------------------------------------------------

  app.get("/v1/auth/passkeys", async (req, reply) => {
    const sessionUser = await requireUser(req, reply);
    if (!sessionUser) return;

    const result = await pool.query<{
      id: string;
      device_name: string | null;
      created_at: Date;
    }>(
      `SELECT id, device_name, created_at
         FROM webauthn_credentials
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [sessionUser.id],
    );

    return {
      passkeys: result.rows.map((row) => ({
        id: row.id,
        deviceName: row.device_name,
        createdAt: row.created_at,
      })),
    };
  });

  // ---------------------------------------------------------------------------
  // DELETE PASSKEY
  // ---------------------------------------------------------------------------

  app.delete("/v1/auth/passkeys/:id", async (req, reply) => {
    const sessionUser = await requireUser(req, reply);
    if (!sessionUser) return;

    if (!(await consumeRateLimit("webauthn", sessionUser.id)).allowed) {
      return reply
        .code(429)
        .send({ error: "Too many requests. Try again later." });
    }

    // Removing a passkey is a sensitive account-change operation.
    if (!(await requireRecentAuth(sessionUser, reply))) return;

    const { id } = req.params as { id: string };

    const authEpoch = await transaction(async (c) => {
      const user = (
        await c.query(
          "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
          [sessionUser.id],
        )
      ).rows[0];
      if (!user) throw failure(404, "Account not found.");
      if (!user.password_hash) {
        const count = await c.query(
          "SELECT count(*) FROM webauthn_credentials WHERE user_id=$1",
          [sessionUser.id],
        );
        if (Number(count.rows[0].count) <= 1)
          throw failure(400, "Cannot remove your only sign-in method.");
      }
      const result = await c.query(
        "DELETE FROM webauthn_credentials WHERE id=$1 AND user_id=$2",
        [id, sessionUser.id],
      );
      if (!result.rowCount) throw failure(404, "Passkey not found.");
      const changed = await c.query(
        "UPDATE users SET auth_epoch=auth_epoch+1 WHERE id=$1 RETURNING auth_epoch",
        [sessionUser.id],
      );
      await c.query("DELETE FROM sessions WHERE user_id=$1", [sessionUser.id]);
      await securityEvent(sessionUser.id, "passkey_removed", req.ip, c);
      return changed.rows[0].auth_epoch as number;
    });
    const session = await createSession(sessionUser.id, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      deviceId: sessionUser.deviceId ?? undefined,
      authEpoch,
    });
    setSessionCookie(reply, session);
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // PASSKEY LOGIN — OPTIONS
  // ---------------------------------------------------------------------------

  app.post("/v1/auth/passkeys/login/options", async (req, reply) => {
    const ip = clientIp(req);

    if (!(await consumeRateLimit("webauthn", ip)).allowed) {
      return reply
        .code(429)
        .send({ error: "Too many requests. Try again later." });
    }

    const options = await generateAuthenticationOptions({
      rpID: config.WEBAUTHN_RP_ID,
      userVerification: "required",
    });

    await putChallenge(`auth:${options.challenge}`, options.challenge);

    reply.setCookie(LOGIN_CHALLENGE_COOKIE, options.challenge, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 300,
      secure: config.COOKIE_SECURE,
    });

    return options;
  });

  // ---------------------------------------------------------------------------
  // PASSKEY LOGIN — VERIFY
  // ---------------------------------------------------------------------------

  app.post("/v1/auth/passkeys/login/verify", async (req, reply) => {
    const ip = clientIp(req);

    if (!(await consumeRateLimit("webauthn", ip)).allowed) {
      return reply
        .code(429)
        .send({ error: "Too many requests. Try again later." });
    }

    const cookieChallenge = req.cookies[LOGIN_CHALLENGE_COOKIE];

    if (!cookieChallenge) {
      return reply.code(400).send({ error: "Challenge expired. Start again." });
    }

    const stored = await takeChallenge(`auth:${cookieChallenge}`);

    reply.clearCookie(LOGIN_CHALLENGE_COOKIE, { path: "/" });

    if (!stored) {
      return reply.code(400).send({ error: "Challenge expired. Start again." });
    }

    const parsedBody = WebAuthnAuthenticationResponseSchema.safeParse(req.body);

    if (!parsedBody.success) {
      return reply.code(401).send({
        error: "Passkey sign-in failed.",
      });
    }

    const body = parsedBody.data as AuthenticationResponseJSON;

    let credId: Buffer;

    try {
      credId = Buffer.from(body.id, "base64url");
    } catch {
      return reply.code(401).send({ error: "Passkey sign-in failed." });
    }

    const cred = await pool.query<{
      user_id: string;
      auth_epoch: number;
      public_key: Buffer;
      counter: string;
    }>(
      `SELECT w.user_id, u.auth_epoch, w.public_key, w.counter::text
         FROM webauthn_credentials w JOIN users u ON u.id=w.user_id
        WHERE credential_id = $1`,
      [credId],
    );

    const row = cred.rows[0];

    if (!row) {
      return reply.code(401).send({ error: "Passkey sign-in failed." });
    }

    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: stored,
      expectedOrigin: config.WEBAUTHN_ORIGIN,
      expectedRPID: config.WEBAUTHN_RP_ID,
      requireUserVerification: true,
      credential: {
        id: body.id,
        publicKey: new Uint8Array(row.public_key),
        counter: Number(row.counter),
      },
    });

    if (!verification.verified) {
      return reply.code(401).send({ error: "Passkey sign-in failed." });
    }

    const counterUpdate = await pool.query(
      `UPDATE webauthn_credentials
      SET counter = $2
    WHERE credential_id = $1
      AND counter = $3`,
      [credId, verification.authenticationInfo.newCounter, Number(row.counter)],
    );

    if ((counterUpdate.rowCount ?? 0) !== 1) {
      return reply.code(401).send({
        error: "Passkey sign-in failed.",
      });
    }

    await completeSignIn(req, reply, row.user_id, "passkey", row.auth_epoch);

    return { ok: true };
  });
}
