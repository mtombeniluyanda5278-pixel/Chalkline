import { randomUUID } from "node:crypto";
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "./app.js";
import { pool } from "./db.js";
import {
  clearTestRateLimits,
  closeRedis,
  connectRedis,
} from "./rateLimit.js";

const app = await buildApp();

const createdEmails: string[] = [];

before(async () => {
  await pool.query("SELECT 1");
  await connectRedis();
  await clearTestRateLimits();
});

afterEach(async () => {
  if (createdEmails.length === 0) {
    return;
  }

  await pool.query(
    `DELETE FROM users WHERE email = ANY($1::citext[])`,
    [createdEmails.splice(0)],
  );
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
    email: `test-${id}@example.com`,
    password: "correct horse battery staple",
    confirmPassword: "correct horse battery staple",
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

test("POST /v1/auth/register creates a user and session", async () => {
  const input = validRegistration();
  createdEmails.push(input.email);

  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: input,
  });

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
  assert.equal(dbResult.rows[0].email_verified_at, null);
  assert.ok(dbResult.rows[0].password_hash);
});

test("POST /v1/auth/login authenticates an existing user", async () => {
  const input = validRegistration();
  createdEmails.push(input.email);

  const registerResponse = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: input,
  });

  assert.equal(registerResponse.statusCode, 201);

  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: {
      email: input.email,
      password: input.password,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().user.email, input.email);

  const cookie = firstSetCookie(response.headers["set-cookie"]);

  assert.match(cookie, /^chalkline_session=/);
});

test("authenticated GET /v1/me returns the current user", async () => {
  const input = validRegistration();
  createdEmails.push(input.email);

  const registerResponse = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: input,
  });

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

  const registerResponse = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: input,
  });

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