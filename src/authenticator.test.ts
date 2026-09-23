import { test, before, after, afterEach } from "node:test";
import type {
  InjectPayload,
  Response as LightMyRequestResponse,
} from "light-my-request";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "./app.js";
import { pool } from "./db.js";
import { createSession, hashToken } from "./sessions.js";
import { connectRedis, closeRedis, clearTestRateLimits } from "./rateLimit.js";
import { authenticator } from "./totp.js";
const app = await buildApp();
const ids: string[] = [];
before(async () => {
  await connectRedis();
  await clearTestRateLimits();
});
afterEach(async () => {
  await clearTestRateLimits();
});
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
  await app.close();
  await closeRedis();
  await pool.end();
});
async function account() {
  const id = randomUUID(),
    email = `totp-${id}@example.com`;
  ids.push(id);
  await pool.query(
    "INSERT INTO users(id,email,username,first_name,last_name,country,date_of_birth,email_verified_at) VALUES($1,$2,$3,'Test','Teacher','ZA','2000-01-01',now())",
    [id, email, `t${id.replaceAll("-", "").slice(0, 15)}`],
  );
  const session = await createSession(id, { authMethod: "email_otp" });
  // A browser the account already trusts. TOTP on an unrecognised browser is
  // answered with a device-approval challenge, so tests that want a session
  // straight from TOTP login must present this device cookie.
  const raw = randomUUID();
  await pool.query(
    "INSERT INTO trusted_devices(user_id,token_hash,label,expires_at) VALUES($1,$2,'Test browser',now()+interval '30 days')",
    [id, hashToken(raw)],
  );
  return {
    id,
    email,
    cookie: `chalkline_session=${session.token}`,
    deviceCookie: `chalkline_device=${raw}`,
  };
}
const post = (
  url: string,
  payload: InjectPayload,
  cookie?: string,
): Promise<LightMyRequestResponse> =>
  app.inject({
    method: "POST",
    url,
    payload,
    headers: cookie ? { cookie } : {},
  });
async function enroll(user: Awaited<ReturnType<typeof account>>) {
  const setup = await post("/v1/auth/authenticator/setup", {}, user.cookie);
  assert.equal(setup.statusCode, 200, setup.body);
  const secret = setup.json().secret;
  const result = await post(
    "/v1/auth/authenticator/confirm",
    { code: authenticator(secret).generate({ timestamp: Date.now() - 30000 }) },
    user.cookie,
  );
  assert.equal(result.statusCode, 200, result.body);
  return secret;
}
test("setup is session-bound, expires, and never becomes usable before confirmation", async () => {
  const user = await account();
  assert.equal(
    (await post("/v1/auth/authenticator/setup", {})).statusCode,
    401,
  );
  const setup = await post("/v1/auth/authenticator/setup", {}, user.cookie);
  assert.equal(setup.statusCode, 200, setup.body);
  assert.equal(setup.headers["cache-control"], "no-store");
  assert.match(setup.json().qr, /^data:image\/png/);
  const secret = setup.json().secret,
    code = authenticator(secret).generate();
  assert.equal(
    (await post("/v1/auth/authenticator/login", { email: user.email, code }))
      .statusCode,
    401,
  );
  const other = await createSession(user.id, { authMethod: "email_otp" });
  assert.equal(
    (
      await post(
        "/v1/auth/authenticator/confirm",
        { code },
        `chalkline_session=${other.token}`,
      )
    ).statusCode,
    400,
  );
  await pool.query(
    "UPDATE authenticator_enrollments SET expires_at=now()-interval '1 second' WHERE user_id=$1",
    [user.id],
  );
  assert.equal(
    (await post("/v1/auth/authenticator/confirm", { code }, user.cookie))
      .statusCode,
    400,
  );
});
test("confirmed authenticator logs in, rejects concurrent replay, and removal revokes access", async () => {
  const user = await account(),
    secret = await enroll(user);
  // Promise.all over a two-element map always yields both entries, which
  // noUncheckedIndexedAccess cannot see; the assertions below are the real check.
  const [a, b] = (await Promise.all(
    [1, 2].map(() =>
      post(
        "/v1/auth/authenticator/login",
        { email: user.email, code: authenticator(secret).generate() },
        user.deviceCookie,
      ),
    ),
  )) as [LightMyRequestResponse, LightMyRequestResponse];
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 401]);
  const login = a.statusCode === 200 ? a : b;
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const me = await app.inject({ url: "/v1/me", headers: { cookie } });
  assert.equal(me.statusCode, 200, me.body);
  assert.equal(me.json().user.hasAuthenticator, true);
  const status = await app.inject({
    url: "/v1/auth/authenticator",
    headers: { cookie },
  });
  assert.deepEqual(status.json(), { enabled: true });
  const removed = await app.inject({
    method: "DELETE",
    url: "/v1/auth/authenticator",
    headers: { cookie: user.cookie },
  });
  assert.equal(removed.statusCode, 200, removed.body);
  assert.equal(
    (await app.inject({ url: "/v1/me", headers: { cookie } })).statusCode,
    401,
  );
  assert.equal(
    (
      await post("/v1/auth/authenticator/login", {
        email: user.email,
        code: authenticator(secret).generate({ timestamp: Date.now() + 30000 }),
      })
    ).statusCode,
    401,
  );
});
test("stale sessions cannot enroll or remove; invalid guesses are limited; suspended users cannot log in", async () => {
  const user = await account(),
    secret = await enroll(user);
  await pool.query(
    "UPDATE sessions SET reauthenticated_at=now()-interval '20 minutes' WHERE user_id=$1",
    [user.id],
  );
  // requireRecentAuth answers 401 + REAUTH_REQUIRED, which app.js keys its
  // re-authentication prompt off; 403 here would silently break that prompt.
  assert.equal(
    (await post("/v1/auth/authenticator/setup", {}, user.cookie)).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: "/v1/auth/authenticator",
        headers: { cookie: user.cookie },
      })
    ).statusCode,
    401,
  );
  await pool.query("UPDATE users SET suspended_at=now() WHERE id=$1", [
    user.id,
  ]);
  assert.equal(
    (
      await post("/v1/auth/authenticator/login", {
        email: user.email,
        code: authenticator(secret).generate(),
      })
    ).statusCode,
    401,
  );
  for (let i = 0; i < 5; i++)
    await post("/v1/auth/authenticator/login", {
      email: user.email,
      code: "000000",
    });
  assert.equal(
    (
      await post("/v1/auth/authenticator/login", {
        email: user.email,
        code: "000000",
      })
    ).statusCode,
    429,
  );
});
test("retired password routes cannot authenticate, reset, or create a password", async () => {
  const user = await account();
  for (const route of [
    "/v1/auth/login",
    "/v1/auth/reauth",
    "/v1/me/password",
    "/v1/auth/password-reset/request",
    "/v1/auth/password-reset/confirm",
  ]) {
    const response = await post(
      route,
      { email: user.email, password: "previous password" },
      user.cookie,
    );
    assert.equal(response.statusCode, 404, route);
  }
  for (const route of ["/v1/auth/register", "/v1/auth/passwordless/register"]) {
    const response = await post(route, {
      firstName: "New",
      lastName: "User",
      email: "new@example.com",
      username: "new.user",
      dateOfBirth: "2000-01-01",
      acceptTerms: true,
      password: "previous password",
      confirmPassword: "previous password",
    });
    assert.equal(response.statusCode, 400, response.body);
  }
  await assert.rejects(
    pool.query("UPDATE users SET password_hash='retired' WHERE id=$1", [
      user.id,
    ]),
  );
});
