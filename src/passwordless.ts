import { securityEvent } from "./security.js";
import {
  randomBytes,
  randomInt,
  randomUUID,
  createHmac,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import type { PoolClient } from "pg";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { config } from "./config.js";
import { pool } from "./db.js";
import { transaction } from "./transactions.js";
import { redis } from "./rateLimit.js";
import { limit, parse, failure } from "./http.js";
import { recoveryProtection, verifyBot } from "./bot.js";
import {
  deliverDevOrLogEmail,
  sendAdminAccountCreatedNotification,
} from "./mail.js";
import { RegisterInput } from "./validation.js";
import { deviceForSignIn } from "./devices.js";
import {
  createSession,
  setSessionCookie,
  readSessionUser,
  lockSessionUser,
  sessionTokens,
  hashToken,
} from "./sessions.js";

const emailSchema = z.string().trim().email().max(254).toLowerCase();
const cookie = {
  httpOnly: true,
  secure: config.COOKIE_SECURE || config.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 600,
};
const googleEnabled = () =>
  Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
const redirectUri = () => `${config.WEBAUTHN_ORIGIN}/v1/auth/google/callback`;
const codeHash = (issuance: string, code: string) =>
  createHmac("sha256", config.SESSION_SECRET)
    .update(`login:${issuance}:${code}`)
    .digest();
const registrationResponse = {
  ok: true,
  verificationRequired: true,
  message:
    "Check your email, or sign in if you already have an account. If no code arrives, try a different username.",
};
const pendingKey = (raw: string) =>
  `google:pending:${hashToken(raw).toString("hex")}`;
type GoogleIdentity = {
  sub: string;
  email: string;
  firstName: string;
  lastName: string;
};
async function pendingGoogle(
  req: FastifyRequest,
): Promise<GoogleIdentity | null> {
  const raw = req.cookies.chix_google_pending;
  if (!raw || raw.length > 100) return null;
  const saved = await redis.get(pendingKey(raw));
  return saved ? JSON.parse(saved) : null;
}
async function clearGoogle(req: FastifyRequest, reply: FastifyReply) {
  if (req.cookies.chix_google_pending)
    await redis.del(pendingKey(req.cookies.chix_google_pending));
  reply.clearCookie("chix_google_pending", { path: "/" });
}
export async function issueLoginCode(
  c: PoolClient,
  user: { id: string; email: string; auth_epoch: number },
  sessionId?: string,
  purpose?: "email_change",
) {
  const budget = await c.query(
    `UPDATE users SET
    otp_delivery_count=CASE WHEN otp_delivery_window<now()-interval '1 hour' THEN 1 ELSE otp_delivery_count+1 END,
    otp_delivery_window=CASE WHEN otp_delivery_window<now()-interval '1 hour' THEN now() ELSE otp_delivery_window END
    WHERE id=$1 AND (otp_delivery_window<now()-interval '1 hour' OR otp_delivery_count<10) RETURNING id`,
    [user.id],
  );
  if (!budget.rowCount)
    throw failure(429, "Too many codes requested. Try later.");
  await c.query(
    "DELETE FROM login_codes WHERE user_id=$1 AND (expires_at<=now() OR session_id IS NOT DISTINCT FROM $2::uuid)",
    [user.id, sessionId ?? null],
  );
  if (
    (await c.query("SELECT 1 FROM login_codes WHERE user_id=$1", [user.id]))
      .rowCount! >= 10
  )
    throw failure(429, "Too many active challenges.");
  const issuance = randomUUID();
  const code = String(randomInt(1_000_000)).padStart(6, "0");
  await c.query(
    `INSERT INTO login_codes(user_id,issuance,code_hash,target_email,auth_epoch,session_id,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')`,
    [
      user.id,
      issuance,
      codeHash(issuance, code),
      user.email,
      user.auth_epoch,
      sessionId ?? null,
    ],
  );
  await deliverDevOrLogEmail(
    {
      userId: user.id,
      to: user.email,
      subject:
        purpose === "email_change"
          ? "Chix: verify your email change"
          : "Chix: your sign-in code",
      body:
        purpose === "email_change"
          ? `Your Chix email-change verification code is ${code}. Use this code to verify that you requested a change to your account email address. It expires in 10 minutes and can be used once. Your email address has not changed yet. Never share this code. If you did not request an email change, do not use or share this code.`
          : `Your Chix code is ${code}. It expires in 10 minutes and can be used once. Never share this code. If you did not request it, ignore this email.`,
    },
    c,
    `login:${issuance}`,
  );
  await c.query(
    "UPDATE notification_outbox SET expires_at=now()+interval '10 minutes' WHERE dedupe_key=$1",
    [`login:${issuance}`],
  );
}
async function signIn(
  c: PoolClient,
  req: FastifyRequest,
  reply: FastifyReply,
  user: { id: string; auth_epoch: number },
  method: "email_otp" | "google",
  trustDevice = false,
) {
  // Issue and consume proof in the same transaction. Rotate this browser's session.
  const tokens = sessionTokens(req);
  if (tokens.length)
    await c.query(
      "DELETE FROM sessions WHERE token_hash=ANY($1::bytea[]) AND user_id=$2",
      [tokens.map(hashToken), user.id],
    );
  const session = await createSession(
    user.id,
    {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      deviceId: await deviceForSignIn(c, req, reply, user.id, trustDevice),
      authEpoch: user.auth_epoch,
      authMethod: method,
    },
    c,
  );
  await securityEvent(
    user.id,
    "login_success",
    req.ip,
    c,
    req.headers["user-agent"],
  );
  return session;
}
export async function registerPasswordlessRoutes(app: FastifyInstance) {
  app.get("/v1/auth/methods", async () => ({
    google: googleEnabled(),
    emailOtp: true,
  }));
  // The sign-in screen asks for an address first and then offers only what that
  // account can actually use, so teachers are never shown a passkey prompt
  // their school desktop cannot answer.
  app.post("/v1/auth/methods", async (req) => {
    const body = parse(
      z.strictObject({
        email: z.string().trim().email().max(254).toLowerCase(),
      }),
      req.body,
    );
    await limit("signInMethods", req.ip);
    const account = (
      await pool.query(
        `SELECT u.role,
                EXISTS(SELECT 1 FROM authenticators a WHERE a.user_id=u.id) AS authenticator,
                EXISTS(SELECT 1 FROM webauthn_credentials w WHERE w.user_id=u.id) AS passkey
           FROM users u WHERE u.email=$1`,
        [body.email],
      )
    ).rows[0];
    // An unknown address answers exactly as an ordinary account does. Anything
    // that distinguished them would turn this into an account-discovery oracle.
    return {
      emailOtp: true,
      google: googleEnabled(),
      authenticator: Boolean(account?.authenticator),
      // Passkeys stay with the administrator: every other sign-in method
      // already establishes trust on a new browser, so this costs teachers
      // nothing and spares them a prompt most of their devices cannot satisfy.
      passkey: Boolean(account?.passkey && account.role === "admin"),
    };
  });
  app.get("/v1/auth/google/pending", async (req) => {
    const identity = await pendingGoogle(req);
    return identity
      ? {
          email: identity.email,
          firstName: identity.firstName,
          lastName: identity.lastName,
        }
      : {};
  });
  app.post("/v1/auth/otp/request", async (req) => {
    const body = parse(
      z.strictObject({
        email: emailSchema,
        captchaToken: z.string().max(4096).optional(),
      }),
      req.body,
    );
    await recoveryProtection(
      "verification_resend",
      body.email,
      req.ip,
      body.captchaToken,
    );
    await transaction(async (c) => {
      const user = (
        await c.query(
          "SELECT id,email,auth_epoch FROM users WHERE email=$1 AND suspended_at IS NULL FOR UPDATE",
          [body.email],
        )
      ).rows[0];
      if (user) await issueLoginCode(c, user);
    });
    return {
      ok: true,
      message: "If this email has an account, a code is on its way.",
    };
  });
  app.post("/v1/auth/otp/reauth/request", async (req) => {
    const body = parse(
      z.strictObject({ purpose: z.literal("email_change").optional() }),
      req.body ?? {},
    );
    const session = await readSessionUser(req);
    if (!session) throw failure(401, "Sign in again to continue.");
    await limit("resendVerificationIp", req.ip);
    await limit("resendVerification", session.id);
    await transaction(async (c) => {
      const user = await lockSessionUser(c, session);
      await issueLoginCode(c, user, session.sessionId, body.purpose);
    });
    return { ok: true };
  });
  app.post("/v1/auth/otp/verify", async (req, reply) => {
    const body = parse(
      z.strictObject({
        email: emailSchema.optional(),
        code: z.string().regex(/^\d{6}$/),
        reauth: z.boolean().default(false),
        // "Remember this browser": without a trusted device the session is
        // capped at 43200s and the user's session_days preference is ignored.
        trustDevice: z.boolean().default(false),
      }),
      req.body,
    );
    await limit("verifyEmailAttempt", req.ip);
    const active = body.reauth ? await readSessionUser(req) : null;
    if (body.reauth && !active)
      throw failure(401, "Sign in again to continue.");
    if (!body.reauth && !body.email) throw failure(400, "Enter your email.");
    const google = await pendingGoogle(req);
    const outcome = await transaction(async (c) => {
      const user = active
        ? await lockSessionUser(c, active)
        : (
            await c.query(
              "SELECT * FROM users WHERE email=$1 AND suspended_at IS NULL FOR UPDATE",
              [body.email],
            )
          ).rows[0];
      if (!user) return null;
      const code = (
        await c.query(
          "SELECT * FROM login_codes WHERE user_id=$1 AND session_id IS NOT DISTINCT FROM $2::uuid AND expires_at>now() AND attempts<5 FOR UPDATE",
          [user.id, active?.sessionId ?? null],
        )
      ).rows[0];
      if (
        !code ||
        code.auth_epoch !== user.auth_epoch ||
        String(code.target_email).toLowerCase() !==
          String(user.email).toLowerCase() ||
        (code.session_id ?? null) !== (active?.sessionId ?? null)
      )
        return null;
      const budget = await c.query(
        `UPDATE users SET
        otp_failed_attempts=CASE WHEN otp_attempt_window<now()-interval '10 minutes' THEN 1 ELSE otp_failed_attempts+1 END,
        otp_attempt_window=CASE WHEN otp_attempt_window<now()-interval '10 minutes' THEN now() ELSE otp_attempt_window END
        WHERE id=$1 AND (otp_attempt_window<now()-interval '10 minutes' OR otp_failed_attempts<5) RETURNING id`,
        [user.id],
      );
      if (!budget.rowCount) return null;
      // Do not throw here: incorrect guesses must commit their attempt counter.
      await c.query(
        "UPDATE login_codes SET attempts=attempts+1 WHERE issuance=$1",
        [code.issuance],
      );
      if (!timingSafeEqual(code.code_hash, codeHash(code.issuance, body.code)))
        return null;
      await c.query("DELETE FROM login_codes WHERE issuance=$1", [
        code.issuance,
      ]);
      await c.query(
        "UPDATE users SET otp_failed_attempts=greatest(0,otp_failed_attempts-1) WHERE id=$1",
        [user.id],
      );
      if (active) {
        await c.query(
          "UPDATE sessions SET reauthenticated_at=now(),auth_method='email_otp' WHERE id=$1",
          [active.sessionId],
        );
        return { ok: true };
      }
      await c.query(
        "UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()),registration_pending=false WHERE id=$1",
        [user.id],
      );
      // Email collision links only after proof of the existing mailbox in this browser.
      if (
        google &&
        google.email === String(user.email).toLowerCase() &&
        !user.google_subject
      )
        await c.query("UPDATE users SET google_subject=$2 WHERE id=$1", [
          user.id,
          google.sub,
        ]);
      return {
        ok: true,
        session: await signIn(
          c,
          req,
          reply,
          user,
          "email_otp",
          body.trustDevice,
        ),
        newAccount: user.registration_pending,
      };
    });
    if (!outcome)
      throw failure(
        400,
        "Invalid or expired code. Request a new code after five attempts.",
      );
    if ("session" in outcome && outcome.session)
      setSessionCookie(reply, outcome.session);
    await clearGoogle(req, reply);
    return {
      ok: true,
      newAccount: "newAccount" in outcome && Boolean(outcome.newAccount),
    };
  });
  app.post("/v1/auth/passwordless/register", async (req, reply) => {
    const body = parse(RegisterInput, req.body);
    await limit("signup", req.ip);
    if (config.BOT_REQUIRE_REGISTRATION)
      await verifyBot(body.captchaToken, "register");
    const google = await pendingGoogle(req);
    if (google && google.email !== body.email)
      throw failure(400, "Use the email verified by Google.");
    let session;
    try {
      session = await transaction(async (c) => {
        const user = (
          await c.query(
            `INSERT INTO users(email,username,first_name,last_name,date_of_birth,country,timezone,session_days,consents_at,marketing_announcements,marketing_apps,registration_pending,email_verified_at,google_subject)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),$9,$10,$11,CASE WHEN $11 THEN NULL ELSE now() END,$12) RETURNING *`,
            [
              body.email,
              body.username,
              body.firstName,
              body.lastName,
              body.dateOfBirth,
              body.country ?? null,
              body.timezone,
              config.SESSION_DEFAULT_DAYS,
              body.marketingAnnouncements,
              body.marketingApps,
              !google,
              google?.sub ?? null,
            ],
          )
        ).rows[0];
        await c.query(
          "INSERT INTO security_events(user_id,event) VALUES($1,'account_created')",
          [user.id],
        );
        await sendAdminAccountCreatedNotification(
          { userId: user.id, createdAt: user.created_at },
          c,
        );
        if (google) return signIn(c, req, reply, user, "google");
        await issueLoginCode(c, user);
        return null;
      });
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      ))
        throw error;
      // Same response for duplicate email/username; recovery uses the login request.
      return reply.code(201).send(registrationResponse);
    }
    if (session) {
      setSessionCookie(reply, session);
      await clearGoogle(req, reply);
    }
    return reply
      .code(201)
      .send(
        session
          ? { ok: true, verificationRequired: false }
          : registrationResponse,
      );
  });
  app.post("/v1/auth/google/start", async (req, reply) => {
    if (!googleEnabled())
      throw failure(503, "Google sign-in is not configured yet.", {
        expose: true,
      });
    await limit("login", req.ip);
    await clearGoogle(req, reply);
    const state = randomBytes(32).toString("base64url"),
      nonce = randomBytes(32).toString("base64url"),
      verifier = randomBytes(32).toString("base64url");
    await redis.set(
      `google:state:${hashToken(state).toString("hex")}`,
      JSON.stringify({ nonce, verifier }),
      "EX",
      600,
    );
    reply.setCookie("chix_google_state", state, cookie);
    const params = new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID!,
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
  });
  app.get("/v1/auth/google/callback", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    reply.clearCookie("chix_google_state", { path: "/" });
    try {
      const query = parse(
        z.object({ state: z.string().max(100), code: z.string().max(4096) }),
        req.query,
      );
      if (query.state !== req.cookies.chix_google_state || !googleEnabled())
        throw Error("state");
      const saved = await redis.getdel(
        `google:state:${hashToken(query.state).toString("hex")}`,
      );
      if (!saved) throw Error("expired");
      const { nonce, verifier } = JSON.parse(saved);
      const client = new OAuth2Client(
        config.GOOGLE_CLIENT_ID,
        config.GOOGLE_CLIENT_SECRET,
        redirectUri(),
      );
      const { tokens } = await client.getToken({
        code: query.code,
        codeVerifier: verifier,
      });
      if (!tokens.id_token) throw Error("missing token");
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: config.GOOGLE_CLIENT_ID,
      });
      const claims = ticket.getPayload();
      if (
        !claims ||
        (claims as unknown as { nonce: string }).nonce !== nonce ||
        !claims.email_verified ||
        !claims.email ||
        !claims.sub
      )
        throw Error("identity");
      const identity: GoogleIdentity = {
        sub: claims.sub,
        email: parse(emailSchema, claims.email),
        firstName: claims.given_name ?? "",
        lastName: claims.family_name ?? "",
      };
      const result = await transaction(async (c) => {
        const user = (
          await c.query(
            "SELECT * FROM users WHERE google_subject=$1 FOR UPDATE",
            [identity.sub],
          )
        ).rows[0];
        if (!user) return null;
        if (user.suspended_at || user.registration_pending)
          throw Error("unavailable");
        return signIn(c, req, reply, user, "google");
      });
      if (result) {
        setSessionCookie(reply, result);
        return reply.redirect("/#/dashboard");
      }
      const pending = randomBytes(32).toString("base64url");
      await redis.set(pendingKey(pending), JSON.stringify(identity), "EX", 600);
      reply.setCookie("chix_google_pending", pending, cookie);
      const existing = await pool.query("SELECT id FROM users WHERE email=$1", [
        identity.email,
      ]);
      return reply.redirect(
        existing.rowCount
          ? "/#/login?google=link"
          : "/#/register?google=profile",
      );
    } catch {
      return reply.redirect("/#/login?google=error");
    }
  });
}
