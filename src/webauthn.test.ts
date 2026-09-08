import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { buildApp } from "./app.js";
import { pool } from "./db.js";
import {
  putChallenge,
  takeChallenge,
} from "./webauthn.js";
import {
  clearTestRateLimits,
  closeRedis,
  connectRedis,
  redis,
} from "./rateLimit.js";

const app = await buildApp();

const createdEmails: string[] = [];

function validRegistration(overrides: Record<string, unknown> = {}) {
  const id = randomUUID().slice(0, 8);

  return {
    firstName: "WebAuthn",
    lastName: "Test",
    country: "ZA",
    dateOfBirth: "2000-01-01",
    email: `webauthn-${id}@example.com`,
    password: "correct horse battery staple",
    confirmPassword: "correct horse battery staple",
    username: `webauthn.${id.slice(0, 6)}`,
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

before(async () => {
  await pool.query("SELECT 1");
  await connectRedis();
  await clearTestRateLimits();
});

after(async () => {
  if (createdEmails.length > 0) {
    await pool.query(
      `DELETE FROM users WHERE email = ANY($1::citext[])`,
      [createdEmails.splice(0)],
    );
  }

  await app.close();
  await redis.flushdb();
  await closeRedis();
  await pool.end();
});

afterEach(async () => {
  await clearTestRateLimits();
});

test("WebAuthn challenge can be stored and consumed once", async () => {
  const key = "test-one-time";
  const challenge = "test-challenge-value";

  await putChallenge(key, challenge);

  const first = await takeChallenge(key);
  const second = await takeChallenge(key);

  assert.equal(first, challenge);
  assert.equal(second, null);
});

test("WebAuthn challenge is stored with a TTL", async () => {
  const key = "test-ttl";
  const challenge = "test-ttl-value";

  await putChallenge(key, challenge);

  const ttl = await redis.ttl(`webauthn:challenge:${key}`);

  assert.ok(ttl > 0);
  assert.ok(ttl <= 300);

  await takeChallenge(key);
});

test("authenticated user can request passkey registration options", async () => {
  const input = validRegistration();
  createdEmails.push(input.email);

  const registerResponse = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: input,
  });

   assert.equal(registerResponse.statusCode, 201);

  const cookieHeader = registerResponse.headers["set-cookie"];

  assert.ok(cookieHeader);

  const cookie = Array.isArray(cookieHeader)
    ? cookieHeader[0]
    : cookieHeader;

  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/passkeys/register/options",
    headers: {
      cookie,
    },
  });

  assert.equal(response.statusCode, 200);

  const body = response.json();

  assert.equal(typeof body.challenge, "string");
  assert.ok(body.challenge.length > 0);
  assert.equal(typeof body.rp, "object");
  assert.equal(typeof body.user, "object");
});

test("passkey registration options require authentication", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/passkeys/register/options",
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().code, "UNAUTHENTICATED");
});

test("passkey login options return a challenge cookie", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/passkeys/login/options",
  });

  assert.equal(response.statusCode, 200);

  const body = response.json();

  assert.equal(typeof body.challenge, "string");
  assert.ok(body.challenge.length > 0);

  const setCookie = response.headers["set-cookie"];
  assert.ok(setCookie);

  const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert.ok(cookie);

  assert.match(cookie, /^chalkline_webauthn=/);
  assert.match(cookie, /HttpOnly/i);
}); 

test("passkey login verify rejects an unknown credential", async () => {
  const optionsResponse = await app.inject({
    method: "POST",
    url: "/v1/auth/passkeys/login/options",
  });

  assert.equal(optionsResponse.statusCode, 200);

  const setCookie = optionsResponse.headers["set-cookie"];

  assert.ok(setCookie);

  const cookie = Array.isArray(setCookie)
    ? setCookie[0]
    : setCookie;

  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/passkeys/login/verify",
    headers: {
      cookie,
    },
    payload: {
      id: "bm9uc2Vuc2U",
      rawId: "bm9uc2Vuc2U",
      response: {
        clientDataJSON: "bm9uc2Vuc2U",
        authenticatorData: "bm9uc2Vuc2U",
        signature: "bm9uc2Vuc2U",
      },
      type: "public-key",
    },
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), {
    error: "Passkey sign-in failed.",
  });
});

test("passkey login verify rejects a missing challenge", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/passkeys/login/verify",
    payload: {
      id: "bm9uc2Vuc2U",
      rawId: "bm9uc2Vuc2U",
      response: {
        clientDataJSON: "bm9uc2Vuc2U",
        authenticatorData: "bm9uc2Vuc2U",
        signature: "bm9uc2Vuc2U",
      },
      type: "public-key",
    },
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), {
    error: "Challenge expired. Start again.",
  });
});
