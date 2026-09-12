import { registerVerifiedAccount, verificationToken } from "./testAccounts.js";
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync, createHash, sign } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { buildApp } from "./app.js";
import { pool } from "./db.js";
import { config } from "./config.js";
import { createSession, hashToken } from "./sessions.js";
import {
  connectRedis,
  closeRedis,
  clearTestRateLimits,
  redis,
  buckets,
} from "./rateLimit.js";
const app = await buildApp(),
  users: string[] = [];
const password = "correct horse battery staple";
before(connectRedis);
beforeEach(clearTestRateLimits);
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await app.close();
  await closeRedis();
  await pool.end();
});
function input(trustDevice = false) {
  const id = randomUUID().slice(0, 8);
  return {
    email: `scope-${id}@example.com`,
    username: `s.${id}`,
    firstName: "Auth",
    lastName: "Test",
    country: "ZA",
    dateOfBirth: "2000-01-01",
    password,
    confirmPassword: password,
    trustDevice,
  };
}
function cookies(r: any) {
  return [r.headers["set-cookie"]]
    .flat()
    .filter(Boolean)
    .map((s: string) => s.split(";")[0])
    .join("; ");
}
async function account(trust = false) {
  const body = input(trust);
  const r = await registerVerifiedAccount(app, body);
  assert.equal(r.statusCode, 201, r.body);
  const id = r.json().user.id;
  users.push(id);
  return { id, body, cookie: cookies(r), response: r };
}
const post = (url: string, cookie: string, payload?: any) =>
  app.inject({
    method: "POST",
    url,
    headers: { cookie },
    ...(payload === undefined ? {} : { payload }),
  });
async function sessionId(cookie: string) {
  return (
    await pool.query("SELECT id FROM sessions WHERE token_hash=$1", [
      hashToken(/chalkline_session=([^;]+)/.exec(cookie)![1]!),
    ])
  ).rows[0].id;
}

for (const trust of [false, true])
  test(`registration trustDevice=${trust} only records actual trust`, async () => {
    const a = await account(trust);
    assert.equal(
      (
        await pool.query("SELECT id FROM trusted_devices WHERE user_id=$1", [
          a.id,
        ])
      ).rowCount,
      trust ? 1 : 0,
    );
    assert.equal(a.cookie.includes("chalkline_device="), trust);
    assert.equal(
      (
        await pool.query(
          "SELECT id FROM security_events WHERE user_id=$1 AND event='device_trusted_registration'",
          [a.id],
        )
      ).rowCount,
      trust ? 1 : 0,
    );
  });

test("cookies reflect 1/7/30/90 day preferences and temporary sessions", async () => {
  const a = await account(true);
  for (const days of [1, 7, 30, 90]) {
    await pool.query("UPDATE users SET session_days=$2 WHERE id=$1", [
      a.id,
      days,
    ]);
    const r = await post("/v1/auth/login", a.cookie, {
      email: a.body.email,
      password,
    });
    assert.equal(r.statusCode, 200, r.body);
    const c = [r.headers["set-cookie"]]
      .flat()
      .find((s) => s?.startsWith("chalkline_session="))!;
    const age = Number(/Max-Age=(\d+)/.exec(c)![1]);
    assert.ok(age <= days * 86400 && age >= days * 86400 - 3);
    const token = /chalkline_session=([^;]+)/.exec(c)![1]!;
    const row = (
      await pool.query("SELECT expires_at FROM sessions WHERE token_hash=$1", [
        hashToken(token),
      ])
    ).rows[0];
    assert.ok(
      Math.abs(
        new Date(/Expires=([^;]+)/.exec(c)![1]!).getTime() -
          row.expires_at.getTime(),
      ) < 1000,
    );
  }
  const temporary = await account();
  const c = [temporary.response.headers["set-cookie"]]
    .flat()
    .find((s) => s?.startsWith("chalkline_session="))!;
  assert.ok(Number(/Max-Age=(\d+)/.exec(c)![1]) <= 86400);
});

test("session listing excludes every invalid state and exposes no raw IP", async () => {
  const a = await account(true);
  const current = await sessionId(a.cookie);
  const device = (
    await pool.query("SELECT device_id FROM sessions WHERE id=$1", [current])
  ).rows[0].device_id;
  for (const condition of [
    "expires_at=now()-interval '1 second'",
    "last_active_at=now()-interval '20 days'",
    "auth_epoch=-1",
  ]) {
    const s = await createSession(a.id, { ip: "203.0.113.17" });
    await pool.query(`UPDATE sessions SET ${condition} WHERE token_hash=$1`, [
      hashToken(s.token),
    ]);
    assert.equal(
      (
        await app.inject({
          url: "/v1/me",
          headers: { cookie: `chalkline_session=${s.token}` },
        })
      ).statusCode,
      401,
    );
  }
  const d = (
    await pool.query(
      "INSERT INTO trusted_devices(user_id,token_hash,label,expires_at) VALUES($1,$2,'revoked',now()+interval '1 day') RETURNING id",
      [a.id, hashToken(randomUUID())],
    )
  ).rows[0].id;
  const s = await createSession(a.id, { deviceId: d });
  await pool.query("UPDATE trusted_devices SET revoked_at=now() WHERE id=$1", [
    d,
  ]);
  const expired = (
    await pool.query(
      "INSERT INTO trusted_devices(user_id,token_hash,label,expires_at) VALUES($1,$2,'expired',now()-interval '1 day') RETURNING id",
      [a.id, hashToken(randomUUID())],
    )
  ).rows[0].id;
  await createSession(a.id, { deviceId: expired });
  const r = await app.inject({
    url: "/v1/me/sessions",
    headers: { cookie: a.cookie },
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(
    r.json().sessions.map((x: any) => x.id),
    [current],
  );
  assert.equal(r.json().sessions[0].ip, undefined);
  assert.ok(device);
  assert.equal(
    (
      await app.inject({
        url: "/v1/me",
        headers: { cookie: `chalkline_session=${s.token}` },
      })
    ).statusCode,
    401,
  );
  const count = (
    await pool.query("SELECT count(*) FROM sessions WHERE user_id=$1", [a.id])
  ).rows[0].count;
  await app.inject({ url: "/v1/me", headers: { cookie: a.cookie } });
  assert.equal(
    (await pool.query("SELECT count(*) FROM sessions WHERE user_id=$1", [a.id]))
      .rows[0].count,
    count,
  );
});

test("post-commit bootstrap failure preserves one account, event and verification token", async (t) => {
  const body = input();
  const query = pool.query.bind(pool);
  const mock = t.mock.method(pool, "query", async (...args: any[]) => {
    if (String(args[0]).includes("INSERT INTO sessions"))
      throw new Error("injected bootstrap failure");
    return (query as any)(...args);
  });
  const response = await post("/v1/auth/register", "", body);
  const verified = await post("/v1/auth/verify-email", "", {token: await verificationToken(body.email)});
  mock.mock.restore();
  assert.equal(verified.statusCode, 200, verified.body);
  assert.equal(verified.json().signInRequired, true);
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().verificationRequired, true);
  assert.doesNotMatch(response.body, /Could not create/);
  const rows = await pool.query("SELECT id FROM users WHERE email=$1", [
    body.email,
  ]);
  assert.equal(rows.rowCount, 1);
  const id = rows.rows[0].id;
  users.push(id);
  for (const [table, extra] of [
    ["security_events", "AND event='account_created'"],
    ["email_tokens", "AND purpose='verify_email'"],
  ])
    assert.equal(
      (
        await pool.query(`SELECT id FROM ${table} WHERE user_id=$1 ${extra}`, [
          id,
        ])
      ).rowCount,
      1,
    );
  const retry = await post("/v1/auth/register", "", body);
  assert.equal(retry.statusCode, 201);
  assert.equal(
    (await pool.query("SELECT id FROM users WHERE email=$1", [body.email]))
      .rowCount,
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM email_tokens WHERE user_id=$1 AND purpose='verify_email'",
        [id],
      )
    ).rowCount,
    1,
  );
});

test("registration conflicts return generic responses without constraint details", async () => {
  const a = await account();
  for (const payload of [
    { ...input(), email: a.body.email },
    { ...input(), username: a.body.username },
  ]) {
    const r = await post("/v1/auth/register", "", payload);
    assert.equal(r.statusCode, 201, r.body);
    assert.doesNotMatch(
      r.body,
      /already exists|users_email|constraint|duplicate|23505/i,
    );
    assert.equal(r.json().verificationRequired, true);
  }
});

test("password step-up requires session, preserves token, rejects wrong password and rate limits", async () => {
  const a = await account();
  const id = await sessionId(a.cookie);
  await pool.query(
    "UPDATE sessions SET reauthenticated_at=now()-interval '1 day' WHERE id=$1",
    [id],
  );
  assert.equal(
    (await post("/v1/auth/reauth", "", { password })).statusCode,
    401,
  );
  assert.equal(
    (await post("/v1/auth/reauth", a.cookie, { password: "incorrect" }))
      .statusCode,
    401,
  );
  const r = await post("/v1/auth/reauth", a.cookie, { password });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.headers["set-cookie"], undefined);
  assert.ok(
    Date.now() -
      (
        await pool.query(
          "SELECT reauthenticated_at FROM sessions WHERE id=$1",
          [id],
        )
      ).rows[0].reauthenticated_at.getTime() <
      5000,
  );
  for (let n = 2; n < buckets.passwordChange.max; n++)
    await post("/v1/auth/reauth", a.cookie, { password: "incorrect" });
  assert.equal(
    (await post("/v1/auth/reauth", a.cookie, { password })).statusCode,
    429,
  );
});

test("fresh password verification authorizes password change despite old step-up timestamp", async () => {
  const a = await account();
  const id = await sessionId(a.cookie);
  await pool.query(
    "UPDATE sessions SET reauthenticated_at=now()-interval '1 day' WHERE id=$1",
    [id],
  );
  const r = await post("/v1/me/password", a.cookie, {
    currentPassword: password,
    newPassword: "a different secure password",
    confirmPassword: "a different secure password",
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(
    (await app.inject({ url: "/v1/me", headers: { cookie: a.cookie } }))
      .statusCode,
    401,
  );
  assert.equal(
    (await app.inject({ url: "/v1/me", headers: { cookie: cookies(r) } }))
      .statusCode,
    200,
  );
});

async function authenticator(userId: string) {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" }),
    jwk = keys.publicKey.export({ format: "jwk" });
  const cose = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))],
      [-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))],
    ]),
  );
  const id = Buffer.from(randomUUID()).toString("base64url");
  await pool.query(
    "INSERT INTO webauthn_credentials(user_id,credential_id,public_key,counter) VALUES($1,$2,$3,0)",
    [userId, Buffer.from(id, "base64url"), Buffer.from(cose)],
  );
  let count = 0;
  return {
    assertion(
      challenge: string,
      origin = config.WEBAUTHN_ORIGIN,
      rp = config.WEBAUTHN_RP_ID,
      uv = true,
    ) {
      const client = Buffer.from(
        JSON.stringify({ type: "webauthn.get", challenge, origin }),
      );
      const data = Buffer.alloc(37);
      createHash("sha256").update(rp).digest().copy(data);
      data[32] = uv ? 5 : 1;
      data.writeUInt32BE(++count, 33);
      const signature = sign(
        "sha256",
        Buffer.concat([data, createHash("sha256").update(client).digest()]),
        keys.privateKey,
      );
      return {
        id,
        rawId: id,
        type: "public-key",
        response: {
          clientDataJSON: client.toString("base64url"),
          authenticatorData: data.toString("base64url"),
          signature: signature.toString("base64url"),
        },
      };
    },
  };
}
for (const trustDevice of [false, true])
  test(`verified passkey login propagates trustDevice=${trustDevice} and rotates session`, async () => {
    const a = await account();
    const key = await authenticator(a.id);
    const options = await post("/v1/auth/passkeys/login/options", a.cookie);
    const r = await post(
      "/v1/auth/passkeys/login/verify",
      a.cookie + "; " + cookies(options),
      { ...key.assertion(options.json().challenge), trustDevice },
    );
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(
      (await app.inject({ url: "/v1/me", headers: { cookie: a.cookie } }))
        .statusCode,
      401,
    );
    assert.equal(
      (await app.inject({ url: "/v1/me", headers: { cookie: cookies(r) } }))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await pool.query("SELECT id FROM trusted_devices WHERE user_id=$1", [
          a.id,
        ])
      ).rowCount,
      trustDevice ? 1 : 0,
    );
    assert.equal(cookies(r).includes("chalkline_device="), trustDevice);
    assert.equal(
      (
        await pool.query(
          "SELECT id FROM security_events WHERE user_id=$1 AND event='device_trusted_passkey'",
          [a.id],
        )
      ).rowCount,
      trustDevice ? 1 : 0,
    );
    const session = (
      await pool.query("SELECT device_id FROM sessions WHERE user_id=$1", [
        a.id,
      ])
    ).rows[0];
    assert.equal(Boolean(session.device_id), trustDevice);
    if (trustDevice) {
      const raw = /chalkline_device=([^;]+)/.exec(cookies(r))![1]!;
      assert.ok(
        (
          await pool.query(
            "SELECT token_hash FROM trusted_devices WHERE user_id=$1",
            [a.id],
          )
        ).rows[0].token_hash.equals(hashToken(raw)),
      );
    }
  });

test("passkey step-up is one-use, session-bound, UV/origin/RP checked, and cannot switch users", async () => {
  const a = await account(),
    b = await account();
  const key = await authenticator(a.id),
    other = await authenticator(b.id);
  const id = await sessionId(a.cookie);
  const options = () => post("/v1/auth/passkeys/step-up/options", a.cookie);
  assert.equal(
    (await post("/v1/auth/passkeys/step-up/options", "")).statusCode,
    401,
  );
  for (const invalid of [
    "user",
    "origin",
    "rp",
    "uv",
    "challenge",
    "session",
    "expired",
  ]) {
    await clearTestRateLimits();
    await pool.query(
      "UPDATE sessions SET reauthenticated_at=now()-interval '1 day' WHERE id=$1",
      [id],
    );
    const o = await options();
    assert.equal(o.statusCode, 200, o.body);
    const challenge = o.json().challenge;
    const assertion =
      invalid === "user"
        ? other.assertion(challenge)
        : key.assertion(
            invalid === "challenge" ? "wrong" : challenge,
            invalid === "origin"
              ? "https://evil.example"
              : config.WEBAUTHN_ORIGIN,
            invalid === "rp" ? "evil.example" : config.WEBAUTHN_RP_ID,
            invalid !== "uv",
          );
    let cookie = a.cookie;
    if (invalid === "session") {
      const s = await createSession(a.id, {});
      cookie = `chalkline_session=${s.token}`;
    }
    if (invalid === "expired")
      await redis.del(`webauthn:challenge:step:${a.id}:${id}`);
    const r = await post("/v1/auth/passkeys/step-up/verify", cookie, assertion);
    assert.equal(r.statusCode, 401, invalid + ": " + r.body);
    assert.equal(r.headers["set-cookie"], undefined);
    assert.equal(
      (
        await app.inject({ url: "/v1/me", headers: { cookie: a.cookie } })
      ).json().user.id,
      a.id,
    );
    assert.ok(
      Date.now() -
        (
          await pool.query(
            "SELECT reauthenticated_at FROM sessions WHERE id=$1",
            [id],
          )
        ).rows[0].reauthenticated_at.getTime() >
        600000,
    );
  }
  await clearTestRateLimits();
  const o = await options();
  const assertion = key.assertion(o.json().challenge);
  const count = (
    await pool.query("SELECT count(*) FROM sessions WHERE user_id=$1", [a.id])
  ).rows[0].count;
  const r = await post("/v1/auth/passkeys/step-up/verify", a.cookie, assertion);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.headers["set-cookie"], undefined);
  assert.equal(
    (await post("/v1/auth/passkeys/step-up/verify", a.cookie, assertion))
      .statusCode,
    401,
  );
  assert.equal(
    (await pool.query("SELECT count(*) FROM sessions WHERE user_id=$1", [a.id]))
      .rows[0].count,
    count,
  );
  assert.equal(
    (
      await pool.query("SELECT id FROM trusted_devices WHERE user_id=$1", [
        a.id,
      ])
    ).rowCount,
    0,
  );
  assert.ok(
    Date.now() -
      (
        await pool.query(
          "SELECT reauthenticated_at FROM sessions WHERE id=$1",
          [id],
        )
      ).rows[0].reauthenticated_at.getTime() <
      5000,
  );
});

test("port-3000 app serves public assets and SPA routes but never private files", async () => {
  for (const url of [
    "/",
    "/app.js",
    "/workspace.js",
    "/extras.js",
    "/styles.css",
  ]) {
    const r = await app.inject({ url });
    assert.equal(r.statusCode, 200, url);
  }
  assert.equal(
    (await app.inject({ url: "/dashboard" })).headers.location,
    "/#/dashboard",
  );
  for (const url of [
    "/.env",
    "/.local/credentials.json",
    "/src/auth.ts",
    "/sql/001_init.sql",
    "/v1/no-such-route",
  ]) {
    assert.equal((await app.inject({ url })).statusCode, 404, url);
  }
});

test("device approval requires an already trusted browser and recent authentication", async () => {
  const a = await account(false);
  const login = await post("/v1/auth/login", "", {
    email: a.body.email,
    password,
  });
  assert.equal(login.statusCode, 202, login.body);
  const pending = (
    await pool.query(
      "SELECT id FROM device_challenges WHERE user_id=$1 AND status='pending'",
      [a.id],
    )
  ).rows[0];
  const r = await post(`/v1/me/devices/requests/${pending.id}`, a.cookie, {
    decision: "approve",
    number: login.json().number,
  });
  assert.equal(r.statusCode, 403, r.body);
  const trusted = await account(true);
  const challenge = await post("/v1/auth/login", "", {
    email: trusted.body.email,
    password,
  });
  const id = await sessionId(trusted.cookie);
  await pool.query(
    "UPDATE sessions SET reauthenticated_at=now()-interval '1 day' WHERE id=$1",
    [id],
  );
  const request = (
    await pool.query(
      "SELECT id FROM device_challenges WHERE user_id=$1 AND status='pending'",
      [trusted.id],
    )
  ).rows[0];
  const stale = await post(
    `/v1/me/devices/requests/${request.id}`,
    trusted.cookie,
    { decision: "approve", number: challenge.json().number },
  );
  assert.equal(stale.statusCode, 401);
  assert.equal(stale.json().code, "REAUTH_REQUIRED");
});

test("fresh password confirmation authorizes account deletion despite stale step-up time", async () => {
  const a = await account();
  await pool.query(
    "UPDATE sessions SET reauthenticated_at=now()-interval '1 day' WHERE user_id=$1",
    [a.id],
  );
  const r = await app.inject({
    method: "DELETE",
    url: "/v1/me",
    headers: { cookie: a.cookie },
    payload: { password },
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(
    (await app.inject({ url: "/v1/me", headers: { cookie: a.cookie } }))
      .statusCode,
    401,
  );
});

test("passkey login rejects wrong origin, RP, UV and replay before granting trust", async () => {
  const a = await account(),
    key = await authenticator(a.id);
  for (const invalid of ["origin", "rp", "uv"]) {
    await clearTestRateLimits();
    const options = await post("/v1/auth/passkeys/login/options", "");
    const assertion = key.assertion(
      options.json().challenge,
      invalid === "origin" ? "https://evil.example" : config.WEBAUTHN_ORIGIN,
      invalid === "rp" ? "evil.example" : config.WEBAUTHN_RP_ID,
      invalid !== "uv",
    );
    const r = await post("/v1/auth/passkeys/login/verify", cookies(options), {
      ...assertion,
      trustDevice: true,
    });
    assert.equal(r.statusCode, 401, r.body);
    assert.equal(
      (
        await post("/v1/auth/passkeys/login/verify", cookies(options), {
          ...assertion,
          trustDevice: true,
        })
      ).statusCode,
      400,
    );
  }
  assert.equal(
    (
      await pool.query("SELECT id FROM trusted_devices WHERE user_id=$1", [
        a.id,
      ])
    ).rowCount,
    0,
  );
  assert.equal(
    (await pool.query("SELECT id FROM sessions WHERE user_id=$1", [a.id]))
      .rowCount,
    1,
  );
});
