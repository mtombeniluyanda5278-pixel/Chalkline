import { registerVerifiedAccount, verificationToken } from "./testAccounts.js";
import { decryptMail } from "./mail.js";
import { randomUUID } from "node:crypto";
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "./app.js";
import { pool } from "./db.js";
import { clearTestRateLimits, closeRedis, connectRedis } from "./rateLimit.js";

const app = await buildApp();

const createdEmails: string[] = [];

before(async () => {
  await pool.query("SELECT 1");
  await connectRedis();
  await clearTestRateLimits();
});

afterEach(async () => {
  await clearTestRateLimits();
  if (createdEmails.length === 0) {
    return;
  }

  await pool.query(`DELETE FROM users WHERE email = ANY($1::citext[])`, [
    createdEmails.splice(0),
  ]);
});

after(async () => {
  await app.close();
  await closeRedis();
  await pool.end();
});

function validRegistration(overrides: Record<string, unknown> = {}) {
  const id = randomUUID().slice(0, 8);

  return {
    firstName: "Test",
    lastName: "User",
    country: "ZA",
    dateOfBirth: "2000-01-01",
    acceptTerms: true,
    email: `test-${id}@example.com`,
    username: `test.${id.slice(0, 6)}`,
    phone: "+27821234567",
    address: {
      line1: "1 Test Street",
      city: "Cape Town",
      region: "Western Cape",
      postalCode: "8001",
      country: "ZA",
    },
    marketingAnnouncements: false,
    marketingApps: false,
    ...overrides,
  };
}

/**
 * Extracts the first Set-Cookie header value from a response, narrowing
 * `string | string[] | undefined` down to `string`. Throws with a clear
 * message if no cookie was set at all, rather than silently letting
 * `undefined` flow into code that expects a real cookie.
 */
function firstSetCookie(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) {
    throw new Error("Expected a Set-Cookie header on the response, got none.");
  }
  return value;
}

test("GET /health returns 200 and ok", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/health",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true });
});

test("GET /v1/me without a session returns 401", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/v1/me",
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().code, "UNAUTHENTICATED");
});

test("registration plus email verification creates a user and session", async () => {
  const input = validRegistration();
  createdEmails.push(input.email);

  const response = await registerVerifiedAccount(app, input);

  assert.equal(response.statusCode, 201);

  const body = response.json();

  assert.equal(body.user.email, input.email);
  assert.equal(body.user.username, input.username);
  assert.equal(body.user.firstName, "Test");
  assert.equal(body.user.lastName, "User");

  const cookie = firstSetCookie(response.headers["set-cookie"]);
  assert.ok(cookie);

  const dbResult = await pool.query(
    `SELECT email, email_verified_at, password_hash
       FROM users
      WHERE email = $1`,
    [input.email],
  );

  assert.equal(dbResult.rowCount, 1);
  assert.ok(dbResult.rows[0].email_verified_at);
  // Registration is passwordless: accounts must never be created with a hash.
  assert.equal(dbResult.rows[0].password_hash, null);
});

test("registration conflicts use the same public response as a fresh registration", async () => {
  const input = validRegistration();
  createdEmails.push(input.email);

  const fresh = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: input,
  });

  const conflict = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      ...validRegistration(),
      email: input.email,
    },
  });

  assert.equal(fresh.statusCode, 201);
  assert.equal(conflict.statusCode, 201);

  assert.deepEqual(conflict.json(), fresh.json());

  assert.equal(
    JSON.stringify(conflict.json()).includes("already exists"),
    false,
  );
});

test("authenticated GET /v1/me returns the current user", async () => {
  const input = validRegistration();
  createdEmails.push(input.email);

  const registerResponse = await registerVerifiedAccount(app, input);

  assert.equal(registerResponse.statusCode, 201);

  const cookie = firstSetCookie(registerResponse.headers["set-cookie"]);

  const response = await app.inject({
    method: "GET",
    url: "/v1/me",
    headers: {
      cookie,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().user.email, input.email);
});

test("POST /v1/auth/logout destroys the current session", async () => {
  const input = validRegistration();
  createdEmails.push(input.email);

  const registerResponse = await registerVerifiedAccount(app, input);

  assert.equal(registerResponse.statusCode, 201);

  const cookie = firstSetCookie(registerResponse.headers["set-cookie"]);

  const logoutResponse = await app.inject({
    method: "POST",
    url: "/v1/auth/logout",
    headers: {
      cookie,
    },
  });

  assert.equal(logoutResponse.statusCode, 200);
  assert.deepEqual(logoutResponse.json(), { ok: true });

  const meResponse = await app.inject({
    method: "GET",
    url: "/v1/me",
    headers: {
      cookie,
    },
  });

  assert.equal(meResponse.statusCode, 401);
});

test("signup OTP is required, scoped to its email, single-use and country is optional", async () => {
  const input = validRegistration();
  createdEmails.push(input.email);
  const { country, ...payload } = input;
  const registered = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload,
  });
  assert.equal(registered.statusCode, 201);
  assert.equal(registered.headers["set-cookie"], undefined);
  const proof = await verificationToken(input.email);
  assert.match(proof.code, /^[0-9]{6}$/);
  const verify = (payload: unknown) =>
    app.inject({
      method: "POST",
      url: "/v1/auth/verify-email",
      payload: payload as any,
    });
  assert.equal(
    (await verify({ ...proof, email: "missing@example.com" })).statusCode,
    400,
  );
  assert.equal(
    (await verify({ token: "legacy-token-cannot-complete-signup" })).statusCode,
    400,
  );
  const done = await verify(proof);
  assert.equal(done.statusCode, 200);
  assert.ok(done.headers["set-cookie"]);
  assert.equal((await verify(proof)).statusCode, 400);
  const user = (
    await pool.query(
      "SELECT country,registration_pending,email_verified_at FROM users WHERE email=$1",
      [input.email],
    )
  ).rows[0];
  assert.equal(user.country, null);
  assert.equal(user.registration_pending, false);
  assert.ok(user.email_verified_at);
});

test("OTP rejects expired codes, limits guesses and resending invalidates the previous code", async () => {
  const input = validRegistration();
  createdEmails.push(input.email);
  await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: input,
  });
  const proof = await verificationToken(input.email);
  const verify = (code: string) =>
    app.inject({
      method: "POST",
      url: "/v1/auth/verify-email",
      payload: { email: input.email, code },
    });
  const wrong = proof.code === "000000" ? "000001" : "000000";
  for (let i = 0; i < 5; i++)
    assert.equal((await verify(wrong)).statusCode, 400);
  assert.equal((await verify(proof.code)).statusCode, 400);
  const resend = () =>
    app.inject({
      method: "POST",
      url: "/v1/auth/verify-email/resend",
      payload: { email: input.email },
    });
  assert.equal((await resend()).statusCode, 200);
  const fresh = await verificationToken(input.email);
  await pool.query(
    "UPDATE email_tokens SET expires_at=now()-interval '1 second' WHERE user_id=(SELECT id FROM users WHERE email=$1) AND used_at IS NULL",
    [input.email],
  );
  assert.equal((await verify(fresh.code)).statusCode, 400);
  assert.equal((await resend()).statusCode, 200);
  const current = await verificationToken(input.email);
  assert.equal((await verify(current.code)).statusCode, 200);
});
