import { randomUUID } from "node:crypto";
import { test, before, after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { OAuth2Client, LoginTicket } from "google-auth-library";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { decryptMail } from "./mail.js";
import {
  clearTestRateLimits,
  closeRedis,
  connectRedis,
  redis,
} from "./rateLimit.js";
import { hashToken } from "./sessions.js";
import pg from "pg";

const app = await buildApp();
const emails: string[] = [];
const originalGoogle = [config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET];
before(async () => {
  await connectRedis();
  await clearTestRateLimits();
});
afterEach(async () => {
  mock.restoreAll();
  [config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET] = originalGoogle;
  await pool.query("DELETE FROM users WHERE email=ANY($1::citext[])", [
    emails.splice(0),
  ]);
  await clearTestRateLimits();
  const keys = await redis.keys("google:*");
  if (keys.length) await redis.del(...keys);
});
after(async () => {
  await app.close();
  await closeRedis();
  await pool.end();
});
const post = (url: string, payload: object, cookie = "") =>
  app.inject({ method: "POST", url, payload, headers: { cookie } });
function profile() {
  const id = randomUUID().slice(0, 8);
  const body = {
    firstName: "Test",
    lastName: "Teacher",
    email: `otp-${id}@example.com`,
    username: `otp.${id}`,
    dateOfBirth: "2000-01-01",
  };
  emails.push(body.email);
  return body;
}
function cookies(response: { cookies: { name: string; value: string }[] }) {
  return response.cookies
    .filter((c) => c.value)
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}
async function latestCode(email: string) {
  const row = (
    await pool.query(
      "SELECT encrypted_body FROM notification_outbox WHERE recipient=$1 AND subject='Chix: your sign-in code' ORDER BY created_at DESC LIMIT 1",
      [email],
    )
  ).rows[0];
  assert.ok(row, "a code was queued");
  const text = decryptMail(row.encrypted_body);
  const code = text.match(/code is (\d{6})/)?.[1];
  assert.ok(code);
  return code;
}
async function register() {
  const body = profile();
  const response = await post("/v1/auth/passwordless/register", body);
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().verificationRequired, true);
  assert.equal(response.cookies.length, 0);
  return { body, code: await latestCode(body.email) };
}
async function verify(email: string, code: string, cookie = "") {
  return post("/v1/auth/otp/verify", { email, code }, cookie);
}

test("passwordless signup creates no password/session until a single-use email proof succeeds", async () => {
  const { body, code } = await register();
  const before = (
    await pool.query(
      "SELECT password_hash,registration_pending FROM users WHERE email=$1",
      [body.email],
    )
  ).rows[0];
  assert.equal(before.password_hash, null);
  assert.equal(before.registration_pending, true);
  const notification = await pool.query(
    "SELECT id FROM notification_outbox WHERE dedupe_key='account-created:' || (SELECT id::text FROM users WHERE email=$1)",
    [body.email],
  );
  assert.equal(notification.rowCount, 1);
  const responses = await Promise.all([
    verify(body.email, code),
    verify(body.email, code),
  ]);
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 400]);
  const success = responses.find((r) => r.statusCode === 200)!;
  assert.equal(success.json().newAccount, true);
  const me = await app.inject({
    url: "/v1/me",
    headers: { cookie: cookies(success) },
  });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().user.emailVerified, true);
  const sessions = (
    await pool.query(
      "SELECT auth_method FROM sessions WHERE user_id=(SELECT id FROM users WHERE email=$1)",
      [body.email],
    )
  ).rows;
  assert.deepEqual(sessions, [{ auth_method: "email_otp" }]);
});

test("codes commit five failed guesses, resend invalidates old issuance, and codes expire", async () => {
  const { body, code } = await register();
  const wrong = code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++)
    assert.equal((await verify(body.email, wrong)).statusCode, 400);
  assert.equal((await verify(body.email, code)).statusCode, 400);
  const row = (
    await pool.query(
      "SELECT attempts FROM login_codes WHERE user_id=(SELECT id FROM users WHERE email=$1)",
      [body.email],
    )
  ).rows[0];
  assert.equal(row.attempts, 5);
  assert.equal(
    (await post("/v1/auth/otp/request", { email: body.email })).statusCode,
    200,
  );
  const next = await latestCode(body.email);
  if (next !== code)
    assert.equal((await verify(body.email, code)).statusCode, 400);
  await pool.query(
    "UPDATE login_codes SET expires_at=now()-interval '1 second' WHERE user_id=(SELECT id FROM users WHERE email=$1)",
    [body.email],
  );
  assert.equal((await verify(body.email, next)).statusCode, 400);
});

test("code proofs are bound to account, email and credential epoch; suspended accounts cannot sign in", async () => {
  const { body, code } = await register();
  assert.equal((await verify("unknown@example.com", code)).statusCode, 400);
  await pool.query("UPDATE users SET auth_epoch=auth_epoch+1 WHERE email=$1", [
    body.email,
  ]);
  assert.equal((await verify(body.email, code)).statusCode, 400);
  await post("/v1/auth/otp/request", { email: body.email });
  const next = await latestCode(body.email);
  await pool.query("UPDATE users SET suspended_at=now() WHERE email=$1", [
    body.email,
  ]);
  assert.equal((await verify(body.email, next)).statusCode, 400);
});

test("duplicate registration and unknown sign-in requests have generic responses", async () => {
  const { body } = await register();
  const fresh = await post("/v1/auth/passwordless/register", profile());
  const duplicate = await post("/v1/auth/passwordless/register", body);
  assert.deepEqual(duplicate.json(), fresh.json());
  const known = await post("/v1/auth/otp/request", { email: body.email });
  const unknown = await post("/v1/auth/otp/request", {
    email: "unknown@example.com",
  });
  assert.equal(known.statusCode, unknown.statusCode);
  assert.deepEqual(known.json(), unknown.json());
});

test("email-code sign-in rotates the supplied session and rejects its replay", async () => {
  const { body, code } = await register();
  const oldCookie = cookies(await verify(body.email, code));
  await post("/v1/auth/otp/request", { email: body.email });
  const signed = await verify(
    body.email,
    await latestCode(body.email),
    oldCookie,
  );
  assert.equal(signed.statusCode, 200, signed.body);
  assert.notEqual(cookies(signed), oldCookie);
  assert.equal(
    (await app.inject({ url: "/v1/me", headers: { cookie: oldCookie } }))
      .statusCode,
    401,
  );
  assert.equal(
    (await app.inject({ url: "/v1/me", headers: { cookie: cookies(signed) } }))
      .statusCode,
    200,
  );
});

test("changing the mailbox invalidates a previously issued sign-in code", async () => {
  const { body, code } = await register();
  const changedEmail = `changed-${body.email}`;
  emails.push(changedEmail);
  await pool.query("UPDATE users SET email=$2 WHERE email=$1", [
    body.email,
    changedEmail,
  ]);
  assert.equal((await verify(changedEmail, code)).statusCode, 400);
  assert.equal((await verify(body.email, code)).statusCode, 400);
});

test("failed email queuing rolls back registration and preserves the previous resend code", async () => {
  const { body, code } = await register();
  const fresh = profile();
  const query = pg.Client.prototype.query;
  mock.method(
    pg.Client.prototype,
    "query",
    function (this: pg.Client, ...args: any[]) {
      if (
        typeof args[0] === "string" &&
        /INSERT INTO notification_outbox/i.test(args[0])
      )
        throw new Error("Simulated outbox failure");
      return (query as any).apply(this, args);
    },
  );
  assert.equal(
    (await post("/v1/auth/passwordless/register", fresh)).statusCode,
    500,
  );
  assert.equal(
    (await post("/v1/auth/otp/request", { email: body.email })).statusCode,
    500,
  );
  mock.restoreAll();
  assert.equal(
    (await pool.query("SELECT id FROM users WHERE email=$1", [fresh.email]))
      .rowCount,
    0,
  );
  assert.equal((await verify(body.email, code)).statusCode, 200);
});

test("email-change confirmation mail explains the purpose of the first OTP", async () => {
  const { body, code } = await register();
  const cookie = cookies(await verify(body.email, code));
  const response = await post(
    "/v1/auth/otp/reauth/request",
    { purpose: "email_change" },
    cookie,
  );
  assert.equal(response.statusCode, 200);
  const row = (
    await pool.query(
      "SELECT encrypted_body FROM notification_outbox WHERE recipient=$1 AND subject='Chix: verify your email change' ORDER BY created_at DESC LIMIT 1",
      [body.email],
    )
  ).rows[0];
  assert.ok(row);
  const message = decryptMail(row.encrypted_body);
  assert.match(message, /email-change verification code is \d{6}/);
  assert.match(message, /Your email address has not changed yet/);
  const proof = message.match(/code is (\d{6})/)![1];
  assert.equal(
    (await post("/v1/auth/otp/verify", { reauth: true, code: proof }, cookie))
      .statusCode,
    200,
  );
});

test("reauthentication proof cannot be used as login or from a different session", async () => {
  const { body, code } = await register();
  const signed = await verify(body.email, code);
  const cookie = cookies(signed);
  await post("/v1/auth/otp/request", { email: body.email });
  const otherCookie = cookies(
    await verify(body.email, await latestCode(body.email)),
  );
  assert.equal(
    (await post("/v1/auth/otp/reauth/request", {}, cookie)).statusCode,
    200,
  );
  const proof = await latestCode(body.email);
  assert.equal(
    (
      await post(
        "/v1/auth/otp/verify",
        { reauth: true, code: proof },
        otherCookie,
      )
    ).statusCode,
    400,
  );
  assert.equal((await verify(body.email, proof)).statusCode, 400);
  assert.equal(
    (await post("/v1/auth/otp/verify", { reauth: true, code: proof }))
      .statusCode,
    401,
  );
  assert.equal(
    (await post("/v1/auth/otp/verify", { reauth: true, code: proof }, cookie))
      .statusCode,
    200,
  );
  assert.equal(
    (await post("/v1/auth/otp/verify", { reauth: true, code: proof }, cookie))
      .statusCode,
    400,
  );
});

async function googleStart() {
  config.GOOGLE_CLIENT_ID = "test-client";
  config.GOOGLE_CLIENT_SECRET = "test-secret";
  const start = await post("/v1/auth/google/start", {});
  assert.equal(start.statusCode, 200, start.body);
  const url = new URL(start.json().url);
  const state = url.searchParams.get("state")!;
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    `${config.WEBAUTHN_ORIGIN}/v1/auth/google/callback`,
  );
  return {
    state,
    nonce: url.searchParams.get("nonce")!,
    cookie: cookies(start),
  };
}
function mockGoogle(email: string, sub: string, nonce: string, overrides = {}) {
  mock.method(OAuth2Client.prototype, "getToken", async () => ({
    tokens: { id_token: "test-id-token" },
  }));
  mock.method(
    OAuth2Client.prototype,
    "verifyIdToken",
    async () =>
      new LoginTicket("", {
        iss: "https://accounts.google.com",
        aud: "test-client",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 600,
        sub,
        email,
        email_verified: true,
        nonce,
        ...overrides,
      } as any),
  );
}
async function callback(state: string, cookie: string) {
  return app.inject({
    url: `/v1/auth/google/callback?state=${state}&code=test-code`,
    headers: { cookie },
  });
}

test("Google is optional and callbacks reject missing/mismatched/replayed state", async () => {
  config.GOOGLE_CLIENT_ID = "";
  config.GOOGLE_CLIENT_SECRET = "";
  assert.equal((await post("/v1/auth/google/start", {})).statusCode, 503);
  const start = await googleStart();
  assert.equal(
    (await callback(start.state, "")).headers.location,
    "/#/login?google=error",
  );
  assert.ok(
    await redis.get(`google:state:${hashToken(start.state).toString("hex")}`),
  );
  mockGoogle("google@example.com", "sub-state", start.nonce);
  const success = await callback(start.state, start.cookie);
  assert.equal(success.headers.location, "/#/register?google=profile");
  assert.equal(success.headers["cache-control"], "no-store");
  assert.equal(
    (await callback(start.state, start.cookie)).headers.location,
    "/#/login?google=error",
  );
});

test("Google callback validates nonce and verified email before creating pending identity", async () => {
  for (const overrides of [{ nonce: "wrong" }, { email_verified: false }]) {
    const start = await googleStart();
    mockGoogle("google@example.com", "sub-reject", start.nonce, overrides);
    const result = await callback(start.state, start.cookie);
    assert.equal(result.headers.location, "/#/login?google=error");
    assert.equal(
      result.cookies.some((c) => c.name === "chix_google_pending" && c.value),
      false,
    );
    mock.restoreAll();
  }
});

test("new Google identity completes profile and signs in; linked identity signs in by subject", async () => {
  const body = profile();
  const sub = randomUUID();
  const start = await googleStart();
  mockGoogle(body.email, sub, start.nonce);
  const pending = await callback(start.state, start.cookie);
  const cookie = cookies(pending);
  assert.equal(pending.headers.location, "/#/register?google=profile");
  const wrong = await post(
    "/v1/auth/passwordless/register",
    { ...body, email: "different@example.com" },
    cookie,
  );
  assert.equal(wrong.statusCode, 400);
  const created = await post("/v1/auth/passwordless/register", body, cookie);
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().verificationRequired, false);
  assert.ok(created.cookies.some((c) => c.name === "chalkline_session"));
  const oldPending = await app.inject({
    url: "/v1/auth/google/pending",
    headers: { cookie },
  });
  assert.deepEqual(oldPending.json(), {});
  mock.restoreAll();
  const again = await googleStart();
  mockGoogle(body.email, sub, again.nonce);
  const signed = await callback(again.state, again.cookie);
  assert.equal(signed.headers.location, "/#/dashboard");
  assert.ok(signed.cookies.some((c) => c.name === "chalkline_session"));
});

test("Google email collision requires existing mailbox proof before linking", async () => {
  const { body, code } = await register();
  await verify(body.email, code);
  const start = await googleStart();
  const sub = randomUUID();
  mockGoogle(body.email, sub, start.nonce);
  const pending = await callback(start.state, start.cookie);
  assert.equal(pending.headers.location, "/#/login?google=link");
  const before = (
    await pool.query("SELECT google_subject FROM users WHERE email=$1", [
      body.email,
    ])
  ).rows[0];
  assert.equal(before.google_subject, null);
  await post("/v1/auth/otp/request", { email: body.email });
  const linked = await verify(
    body.email,
    await latestCode(body.email),
    cookies(pending),
  );
  assert.equal(linked.statusCode, 200, linked.body);
  const after = (
    await pool.query("SELECT google_subject FROM users WHERE email=$1", [
      body.email,
    ])
  ).rows[0];
  assert.equal(after.google_subject, sub);
});
