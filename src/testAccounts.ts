// Test fixtures explicitly follow the emailed verification flow; raw registration
// privacy tests continue to call /v1/auth/register directly.
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { pool } from "./db.js";
import { decryptMail } from "./mail.js";
import { authenticator } from "./totp.js";
export async function verificationToken(email: string) {
  const row = (
    await pool.query(
      "SELECT n.encrypted_body FROM notification_outbox n JOIN users u ON u.id=n.user_id WHERE u.email=$1 AND n.subject='Chix: verify email' ORDER BY n.created_at DESC, n.id DESC LIMIT 1",
      [email],
    )
  ).rows[0];
  assert.ok(row, "verification mail was queued");
  return {
    email,
    code: /code is: ([0-9]{6})/.exec(decryptMail(row.encrypted_body))![1]!,
  };
}
// Sign-in replacement for the retired POST /v1/auth/login: tests that merely
// need a fresh session cookie go through the emailed one-time code instead.
export async function loginCode(email: string) {
  const row = (
    await pool.query(
      "SELECT n.encrypted_body FROM notification_outbox n JOIN users u ON u.id=n.user_id WHERE u.email=$1 AND n.subject='Chix: your sign-in code' ORDER BY n.created_at DESC, n.id DESC LIMIT 1",
      [email],
    )
  ).rows[0];
  assert.ok(row, "sign-in code mail was queued");
  return /Your Chix code is ([0-9]{6})/.exec(
    decryptMail(row.encrypted_body),
  )![1]!;
}

export async function signIn(
  app: FastifyInstance,
  email: string,
  { trustDevice = false, cookie = "" } = {},
) {
  const requested = await app.inject({
    method: "POST",
    url: "/v1/auth/otp/request",
    payload: { email },
  });
  assert.equal(requested.statusCode, 200, requested.body);
  const verified = await app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    headers: cookie ? { cookie } : {},
    payload: { email, code: await loginCode(email), trustDevice },
  });
  assert.equal(verified.statusCode, 200, verified.body);
  return verified;
}

// TOTP is the one surviving factor that cannot vouch for an unknown browser,
// so it is how tests reach the device-approval challenge.
export async function enrollAuthenticator(
  app: FastifyInstance,
  cookie: string,
) {
  const setup = await app.inject({
    method: "POST",
    url: "/v1/auth/authenticator/setup",
    headers: { cookie },
    payload: {},
  });
  assert.equal(setup.statusCode, 200, setup.body);
  const secret = setup.json().secret as string;
  const confirmed = await app.inject({
    method: "POST",
    url: "/v1/auth/authenticator/confirm",
    headers: { cookie },
    payload: {
      code: authenticator(secret).generate({ timestamp: Date.now() - 30000 }),
    },
  });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  return secret;
}

export function totpLogin(
  app: FastifyInstance,
  email: string,
  secret: string,
  { cookie = "", trustDevice = false } = {},
) {
  return app.inject({
    method: "POST",
    url: "/v1/auth/authenticator/login",
    headers: cookie ? { cookie } : {},
    payload: { email, code: authenticator(secret).generate(), trustDevice },
  });
}

export async function registerVerifiedAccount(
  app: FastifyInstance,
  payload: any,
  verified = true,
) {
  const registered = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload,
  });
  assert.equal(registered.statusCode, 201, registered.body);
  assert.equal(registered.headers["set-cookie"], undefined);
  const token = await verificationToken(payload.email);
  const confirmation = await app.inject({
    method: "POST",
    url: "/v1/auth/verify-email",
    payload: token,
  });
  assert.equal(confirmation.statusCode, 200, confirmation.body);
  const cookie = [confirmation.headers["set-cookie"]]
    .flat()
    .filter(Boolean)
    .map((c) => c!.split(";")[0])
    .join("; ");
  if (!verified)
    await pool.query("UPDATE users SET email_verified_at=NULL WHERE email=$1", [
      payload.email,
    ]);
  const me = await app.inject({ url: "/v1/me", headers: { cookie } });
  assert.equal(me.statusCode, 200, me.body);
  // A fixture response combines verified identity and its issued browser cookies.
  me.statusCode = 201;
  me.headers["set-cookie"] = confirmation.headers["set-cookie"];
  return me;
}
