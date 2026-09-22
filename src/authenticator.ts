import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "./config.js";
import { pool } from "./db.js";
import { requireUser, requireRecentAuth } from "./auth.js";
import {
  lockSessionUser,
  createSession,
  setSessionCookie,
  validSession,
} from "./sessions.js";
import { transaction } from "./transactions.js";
import { completeSignIn } from "./devices.js";
import { parse, limit, failure } from "./http.js";
import { securityEvent } from "./security.js";
import {
  newAuthenticator,
  verifyAuthenticator,
  sealAuthenticator,
  openAuthenticator,
} from "./totp.js";
const codeSchema = z.strictObject({ code: z.string().regex(/^\d{6}$/) });
const seal = (secret: string, id: string) =>
  sealAuthenticator(secret, config.OUTBOX_ENCRYPTION_KEY!, id);
const open = (value: string, id: string) =>
  openAuthenticator(
    value,
    config.OUTBOX_ENCRYPTION_KEY!,
    id,
    config.OUTBOX_PREVIOUS_ENCRYPTION_KEY,
  );
export async function registerAuthenticatorRoutes(app: FastifyInstance) {
  app.get("/v1/auth/authenticator", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const user = await requireUser(req, reply);
    if (!user) return;
    const result = await pool.query(
      "SELECT 1 FROM authenticators WHERE user_id=$1",
      [user.id],
    );
    return { enabled: Boolean(result.rowCount) };
  });
  app.post("/v1/auth/authenticator/setup", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!(await requireRecentAuth(user, reply))) return;
    await limit("authenticatorSetup", user.id);
    return transaction(async (c) => {
      const owner = await lockSessionUser(c, user, true);
      if (!owner.email_verified_at)
        throw failure(
          403,
          "Verify your email before setting up an authenticator.",
        );
      if (
        (
          await c.query("SELECT 1 FROM authenticators WHERE user_id=$1", [
            user.id,
          ])
        ).rowCount
      )
        throw failure(
          409,
          "Remove your existing authenticator before setting up another.",
        );
      const setup = await newAuthenticator(owner.email);
      await c.query(
        "INSERT INTO authenticator_enrollments(user_id,session_id,encrypted_secret,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes') ON CONFLICT(user_id) DO UPDATE SET session_id=excluded.session_id,encrypted_secret=excluded.encrypted_secret,expires_at=excluded.expires_at",
        [user.id, user.sessionId, seal(setup.secret, user.id)],
      );
      return {
        ...setup,
        issuer: "Chix",
        account: owner.email,
        digits: 6,
        period: 30,
        algorithm: "SHA1",
      };
    });
  });
  app.post("/v1/auth/authenticator/confirm", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!(await requireRecentAuth(user, reply))) return;
    await limit("authenticatorVerify", user.id);
    const { code } = parse(codeSchema, req.body);
    await transaction(async (c) => {
      await lockSessionUser(c, user, true);
      const pending = (
        await c.query(
          "SELECT encrypted_secret FROM authenticator_enrollments WHERE user_id=$1 AND session_id=$2 AND expires_at>now()",
          [user.id, user.sessionId],
        )
      ).rows[0];
      if (!pending) throw failure(400, "Setup expired. Start again.");
      const step = verifyAuthenticator(
        open(pending.encrypted_secret, user.id),
        code,
      );
      if (step === null)
        throw failure(
          400,
          "Code invalid or expired. Check your app and try again.",
        );
      await c.query(
        "INSERT INTO authenticators(user_id,encrypted_secret,last_step) VALUES($1,$2,$3)",
        [user.id, pending.encrypted_secret, step],
      );
      await c.query("DELETE FROM authenticator_enrollments WHERE user_id=$1", [
        user.id,
      ]);
      await securityEvent(
        user.id,
        "authenticator_added",
        req.ip,
        c,
        req.headers["user-agent"],
      );
    });
    return { ok: true };
  });
  app.delete("/v1/auth/authenticator/setup", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    await pool.query(
      "DELETE FROM authenticator_enrollments WHERE user_id=$1 AND session_id=$2",
      [user.id, user.sessionId],
    );
    return { ok: true };
  });
  app.delete("/v1/auth/authenticator", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!(await requireRecentAuth(user, reply))) return;
    await limit("authenticatorSetup", user.id);
    const session = await transaction(async (c) => {
      await lockSessionUser(c, user, true);
      await c.query("DELETE FROM authenticators WHERE user_id=$1", [user.id]);
      await c.query("DELETE FROM authenticator_enrollments WHERE user_id=$1", [
        user.id,
      ]);
      const owner = (
        await c.query(
          "UPDATE users SET auth_epoch=auth_epoch+1 WHERE id=$1 RETURNING auth_epoch",
          [user.id],
        )
      ).rows[0];
      await c.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
      await securityEvent(
        user.id,
        "authenticator_removed",
        req.ip,
        c,
        req.headers["user-agent"],
      );
      return createSession(
        user.id,
        {
          ip: req.ip,
          userAgent: req.headers["user-agent"],
          authEpoch: owner.auth_epoch,
          authMethod: user.authMethod,
        },
        c,
      );
    });
    setSessionCookie(reply, session);
    return { ok: true };
  });
  app.post("/v1/auth/authenticator/login", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    await limit("authenticatorLoginIp", req.ip);
    const body = parse(
      codeSchema.extend({
        email: z.string().trim().email().max(254).toLowerCase(),
        trustDevice: z.boolean().default(false),
      }),
      req.body,
    );
    await limit("authenticatorVerify", body.email);
    const owner = await transaction(async (c) => {
      const owner = (
        await c.query(
          "SELECT id,auth_epoch,suspended_at,registration_pending,email_verified_at FROM users WHERE email=$1 FOR UPDATE",
          [body.email],
        )
      ).rows[0];
      const invalid = () =>
        failure(
          401,
          "Email or authenticator code is incorrect, expired, or already used.",
        );
      if (
        !owner ||
        owner.suspended_at ||
        owner.registration_pending ||
        !owner.email_verified_at
      )
        throw invalid();
      const credential = (
        await c.query(
          "SELECT encrypted_secret,last_step FROM authenticators WHERE user_id=$1",
          [owner.id],
        )
      ).rows[0];
      if (!credential) throw invalid();
      const step = verifyAuthenticator(
        open(credential.encrypted_secret, owner.id),
        body.code,
        Number(credential.last_step),
      );
      if (step === null) throw invalid();
      await c.query("UPDATE authenticators SET last_step=$2 WHERE user_id=$1", [
        owner.id,
        step,
      ]);
      await securityEvent(
        owner.id,
        "authenticator_sign_in",
        req.ip,
        c,
        req.headers["user-agent"],
      );
      return owner;
    });
    // A TOTP code alone does not vouch for an unrecognised browser: an
    // already-trusted device has to approve it, exactly as a password did.
    const challenge = await completeSignIn(
      req,
      reply,
      owner.id,
      "totp",
      body.trustDevice,
      owner.auth_epoch,
    );
    // 202: verified, but the browser is not signed in until a trusted device
    // approves it. app.js keys its /device redirect off approvalRequired.
    return challenge ? reply.code(202).send(challenge) : { ok: true };
  });
  app.post("/v1/auth/authenticator/step-up", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    await limit("authenticatorVerify", user.id);
    const { code } = parse(codeSchema, req.body);
    await transaction(async (c) => {
      await lockSessionUser(c, user);
      const row = (
        await c.query(
          "SELECT encrypted_secret,last_step FROM authenticators WHERE user_id=$1",
          [user.id],
        )
      ).rows[0];
      const step = row
        ? verifyAuthenticator(
            open(row.encrypted_secret, user.id),
            code,
            Number(row.last_step),
          )
        : null;
      if (step === null)
        throw failure(401, "Code invalid, expired, or already used.");
      await c.query("UPDATE authenticators SET last_step=$2 WHERE user_id=$1", [
        user.id,
        step,
      ]);
      await c.query(
        `UPDATE sessions s SET reauthenticated_at=now(),auth_method='totp' FROM users u WHERE s.id=$1 AND s.user_id=u.id AND ${validSession}`,
        [user.sessionId],
      );
    });
    return { ok: true };
  });
}
