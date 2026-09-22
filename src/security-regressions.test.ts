import { test, before, after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  randomUUID,
  randomBytes,
  generateKeyPairSync,
  createHash,
} from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { buildApp } from "./app.js";
import { pool } from "./db.js";
import { createSession, hashToken } from "./sessions.js";
import { transaction } from "./transactions.js";
import { issueEmailToken } from "./tokens.js";
import { issueLoginCode } from "./passwordless.js";
import { decryptMail } from "./mail.js";
import { hashPassword } from "./passwords.js";
import { config } from "./config.js";
import { connectRedis, closeRedis, clearTestRateLimits } from "./rateLimit.js";
const app = await buildApp();
const ids: string[] = [];
before(connectRedis);
afterEach(async () => {
  mock.restoreAll();
  await clearTestRateLimits();
});
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
  await app.close();
  await closeRedis();
  await pool.end();
});
async function account(kind = "email") {
  const id = randomUUID();
  const user = (
    await pool.query(
      `INSERT INTO users(email,username,first_name,last_name,date_of_birth,email_verified_at,google_subject,password_hash) VALUES($1,$2,'Test','User','2000-01-01',now(),$3,$4) RETURNING *`,
      [
        `${id}@example.com`,
        id.replaceAll("-", "").slice(0, 12),
        kind === "google" ? id : null,
        kind === "password"
          ? await hashPassword("existing secure password")
          : null,
      ],
    )
  ).rows[0];
  ids.push(user.id);
  const session = await createSession(user.id, {
    authMethod:
      kind === "google"
        ? "google"
        : kind === "password"
          ? "password"
          : "email_otp",
  });
  const sid = (
    await pool.query("SELECT id FROM sessions WHERE token_hash=$1", [
      hashToken(session.token),
    ])
  ).rows[0].id;
  return { user, sid, cookie: `chalkline_session=${session.token}` };
}
const post = (url: string, payload: object, cookie = "") =>
  app.inject({ method: "POST", url, payload, headers: { cookie } });
async function otp(a: Awaited<ReturnType<typeof account>>, sid?: string) {
  await transaction(async (c) => {
    await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [a.user.id]);
    await issueLoginCode(c, a.user, sid);
  });
  const row = (
    await pool.query(
      "SELECT encrypted_body FROM notification_outbox WHERE user_id=$1 AND subject='Chix: your sign-in code' ORDER BY created_at DESC LIMIT 1",
      [a.user.id],
    )
  ).rows[0];
  return /code is (\d{6})/.exec(decryptMail(row.encrypted_body))![1]!;
}
// 'password' dropped: accounts can no longer hold a password hash.
for (const kind of ["email", "google"])
  test(`${kind} account settings and confirmed email change`, async () => {
    const a = await account(kind);
    const creds = {};
    const me = await app.inject({
      url: "/v1/me",
      headers: { cookie: a.cookie },
    });
    assert.equal(me.json().user.hasPassword, kind === "password");
    const target = `${randomUUID()}@example.com`;
    const request = await post(
      "/v1/me/email",
      { email: target, ...creds },
      a.cookie,
    );
    assert.equal(request.statusCode, 200, request.body);
    assert.equal(
      (await pool.query("SELECT email FROM users WHERE id=$1", [a.user.id]))
        .rows[0].email,
      a.user.email,
    );
    const mail = (
      await pool.query(
        "SELECT encrypted_body FROM notification_outbox WHERE user_id=$1 AND subject='Chix: change email' ORDER BY created_at DESC LIMIT 1",
        [a.user.id],
      )
    ).rows[0];
    const token = /token=([^\s]+)/.exec(decryptMail(mail.encrypted_body))![1]!;
    assert.equal(
      (
        await post(
          "/v1/me/username",
          { username: randomUUID().replaceAll("-", "").slice(0, 12), ...creds },
          a.cookie,
        )
      ).statusCode,
      200,
    );
    const confirmed = await post("/v1/auth/change-email", { token });
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    assert.equal(
      (await pool.query("SELECT email FROM users WHERE id=$1", [a.user.id]))
        .rows[0].email,
      target,
    );
    assert.equal(
      (await app.inject({ url: "/v1/me", headers: { cookie: a.cookie } }))
        .statusCode,
      401,
    );
  });
test("stale proof and duplicate settings values fail without mutations", async () => {
  const a = await account(),
    b = await account();
  assert.equal(
    (await post("/v1/me/email", { email: b.user.email }, a.cookie)).statusCode,
    409,
  );
  assert.equal(
    (await post("/v1/me/username", { username: b.user.username }, a.cookie))
      .statusCode,
    409,
  );
  await pool.query(
    "UPDATE sessions SET reauthenticated_at=now()-interval '11 minutes' WHERE id=$1",
    [a.sid],
  );
  assert.equal(
    (await post("/v1/me/username", { username: "unused.name" }, a.cookie))
      .statusCode,
    401,
  );
});
test("login and two session OTP challenges survive independently and cannot cross sessions", async () => {
  const a = await account();
  const second = await createSession(a.user.id, { authMethod: "email_otp" });
  const sid = (
    await pool.query("SELECT id FROM sessions WHERE token_hash=$1", [
      hashToken(second.token),
    ])
  ).rows[0].id;
  const first = await otp(a, a.sid),
    other = await otp(a, sid),
    login = await otp(a);
  const verify = (code: string, cookie: string) =>
    post("/v1/auth/otp/verify", { code, reauth: true }, cookie);
  assert.equal(
    (await verify(first, `chalkline_session=${second.token}`)).statusCode,
    400,
  );
  assert.equal((await verify(first, a.cookie)).statusCode, 200);
  assert.equal(
    (await verify(other, `chalkline_session=${second.token}`)).statusCode,
    200,
  );
  assert.equal(
    (await post("/v1/auth/otp/verify", { email: a.user.email, code: login }))
      .statusCode,
    200,
  );
  assert.equal((await verify(first, a.cookie)).statusCode, 400);
});
async function passkeyResponse(cookie: string) {
  const options = await post("/v1/auth/passkeys/register/options", {}, cookie);
  assert.equal(options.statusCode, 200, options.body);
  const key = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  }).publicKey.export({ format: "jwk" });
  const cose = isoCBOR.encode(
    new Map<number, number | Buffer>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(key.x!, "base64url")],
      [-3, Buffer.from(key.y!, "base64url")],
    ]),
  );
  const id = randomBytes(32),
    length = Buffer.alloc(2);
  length.writeUInt16BE(id.length);
  const authData = Buffer.concat([
    createHash("sha256").update(config.WEBAUTHN_RP_ID).digest(),
    Buffer.from([0x45]),
    Buffer.alloc(4),
    Buffer.alloc(16),
    length,
    id,
    Buffer.from(cose),
  ]);
  const attestation = isoCBOR.encode(
    new Map<string, string | Map<string, never> | Buffer>([
      ["fmt", "none"],
      ["attStmt", new Map<string, never>()],
      ["authData", authData],
    ]),
  );
  return {
    id: id.toString("base64url"),
    rawId: id.toString("base64url"),
    type: "public-key",
    response: {
      clientDataJSON: Buffer.from(
        JSON.stringify({
          type: "webauthn.create",
          challenge: options.json().challenge,
          origin: config.WEBAUTHN_ORIGIN,
        }),
      ).toString("base64url"),
      attestationObject: Buffer.from(attestation).toString("base64url"),
    },
    clientExtensionResults: {},
  };
}
test("verified passkey registration commits one credential and one security event", async () => {
  const a = await account();
  const payload = await passkeyResponse(a.cookie);
  const response = await post(
    "/v1/auth/passkeys/register/verify",
    payload,
    a.cookie,
  );
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(
    (
      await pool.query("SELECT 1 FROM webauthn_credentials WHERE user_id=$1", [
        a.user.id,
      ])
    ).rowCount,
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM security_events WHERE user_id=$1 AND event='passkey_added'",
        [a.user.id],
      )
    ).rowCount,
    1,
  );
});
// Intercept the transaction's first account lock after route authorization.
// The competing transaction commits before the mutation is resumed.
for (const action of ["revoke", "reset", "suspend"])
  for (const route of ["username", "delete", "codes", "passkey"])
    test(`${route} rejects ${action} committed after initial authorization`, async () => {
      const a = await account();
      const attestation =
        route === "passkey" ? await passkeyResponse(a.cookie) : null;
      let reached!: () => void, resume!: () => void;
      const paused = new Promise<void>((r) => (reached = r)),
        gate = new Promise<void>((r) => (resume = r));
      const connect = pool.connect.bind(pool);
      let armed = true;
      const spy = mock.method(pool, "connect", ((...connectionArgs: any[]) => {
        if (connectionArgs.length) return (connect as any)(...connectionArgs);
        return (async () => {
          const c = await connect();
          const query = c.query.bind(c);
          if (armed) {
            armed = false;
            const original = c.query;
            c.query = (async (...args: any[]) => {
              const sql = String(args[0]);
              if (sql === "SELECT * FROM users WHERE id=$1 FOR UPDATE") {
                c.query = original;
                reached();
                await gate;
              }
              return (query as any)(...args);
            }) as typeof c.query;
          }
          return c;
        })();
      }) as typeof pool.connect);
      const request =
        route === "passkey"
          ? post("/v1/auth/passkeys/register/verify", attestation!, a.cookie)
          : route === "delete"
            ? app.inject({
                method: "DELETE",
                url: "/v1/me",
                payload: {},
                headers: { cookie: a.cookie },
              })
            : post(
                route === "codes" ? "/v1/me/recovery-codes" : "/v1/me/username",
                route === "codes" ? {} : { username: "race.changed" },
                a.cookie,
              );
      const running = Promise.resolve(request);
      try {
        await Promise.race([
          paused,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(Error("authorization barrier not reached")),
              5000,
            ),
          ),
        ]);
        spy.mock.restore();
        await transaction(async (c) => {
          await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
            a.user.id,
          ]);
          if (action === "revoke")
            await c.query("DELETE FROM sessions WHERE id=$1", [a.sid]);
          else
            await c.query(
              `UPDATE users SET auth_epoch=auth_epoch+1${action === "suspend" ? ",suspended_at=now()" : ""} WHERE id=$1`,
              [a.user.id],
            );
        });
      } finally {
        resume();
      }
      const response = await running;
      assert.equal(response.statusCode, 401, response.body);
      assert.equal(
        (
          await pool.query("SELECT username FROM users WHERE id=$1", [
            a.user.id,
          ])
        ).rows[0].username,
        a.user.username,
      );
      assert.equal(
        (
          await pool.query("SELECT 1 FROM recovery_codes WHERE user_id=$1", [
            a.user.id,
          ])
        ).rowCount,
        0,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT 1 FROM webauthn_credentials WHERE user_id=$1",
            [a.user.id],
          )
        ).rowCount,
        0,
      );
    });
test("recovery code configured lifetime and atomic one-time expiry checks", async () => {
  const a = await account();
  const old = config.RECOVERY_CODE_DAYS;
  config.RECOVERY_CODE_DAYS = 7;
  let codes: string[];
  try {
    const r = await post("/v1/me/recovery-codes", {}, a.cookie);
    assert.equal(r.statusCode, 200, r.body);
    codes = r.json().codes;
  } finally {
    config.RECOVERY_CODE_DAYS = old;
  }
  const duration = (
    await pool.query(
      "SELECT extract(epoch FROM (expires_at-now())) AS seconds FROM recovery_codes WHERE user_id=$1",
      [a.user.id],
    )
  ).rows[0];
  assert.ok(
    Number(duration.seconds) > 6.9 * 86400 &&
      Number(duration.seconds) <= 7 * 86400,
  );
  const challenge = async () => {
    const raw = randomUUID();
    await pool.query(
      "INSERT INTO device_challenges(user_id,token_hash,matching_number,label,expires_at,auth_epoch) VALUES($1,$2,42,'test',now()+interval '5 minutes',$3)",
      [a.user.id, hashToken(raw), a.user.auth_epoch],
    );
    return `chalkline_pending=${raw}`;
  };
  await pool.query(
    "UPDATE recovery_codes SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
    [hashToken(codes![0]!)],
  );
  assert.equal(
    (
      await post(
        "/v1/devices/recovery/confirm",
        { token: codes![0] },
        await challenge(),
      )
    ).statusCode,
    401,
  );
  const cookie = await challenge();
  const results = await Promise.all([
    post("/v1/devices/recovery/confirm", { token: codes![1] }, cookie),
    post("/v1/devices/recovery/confirm", { token: codes![1] }, cookie),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
});

function failOutbox() {
  const connect = pool.connect.bind(pool);
  return mock.method(pool, "connect", ((...connectionArgs: any[]) => {
    if (connectionArgs.length) return (connect as any)(...connectionArgs);
    return (async () => {
      const c = await connect(),
        query = c.query.bind(c),
        original = c.query;
      c.query = (async (...args: any[]) => {
        if (String(args[0]).startsWith("INSERT INTO notification_outbox")) {
          c.query = original;
          throw Error("Injected outbox delivery failure");
        }
        return (query as any)(...args);
      }) as typeof c.query;
      return c;
    })();
  }) as typeof pool.connect);
}
test("failed email delivery rolls back pending email token without revoking session", async () => {
  const a = await account();
  const spy = failOutbox();
  const response = await post(
    "/v1/me/email",
    { email: "delivery-failed@example.com" },
    a.cookie,
  );
  spy.mock.restore();
  assert.equal(response.statusCode, 500);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM email_tokens WHERE user_id=$1 AND purpose='change_email'",
        [a.user.id],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (await app.inject({ url: "/v1/me", headers: { cookie: a.cookie } }))
      .statusCode,
    200,
  );
});
test("passwordless login notification is encrypted and atomic with session and proof", async () => {
  const a = await account();
  const code = await otp(a);
  const before = Number(
    (
      await pool.query("SELECT count(*) FROM sessions WHERE user_id=$1", [
        a.user.id,
      ])
    ).rows[0].count,
  );
  const wrong = code === "000000" ? "999999" : "000000";
  assert.equal(
    (await post("/v1/auth/otp/verify", { email: a.user.email, code: wrong }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM security_events WHERE user_id=$1 AND event='login_success'",
        [a.user.id],
      )
    ).rowCount,
    0,
  );
  const spy = failOutbox();
  assert.equal(
    (await post("/v1/auth/otp/verify", { email: a.user.email, code }))
      .statusCode,
    500,
  );
  spy.mock.restore();
  assert.equal(
    Number(
      (
        await pool.query("SELECT count(*) FROM sessions WHERE user_id=$1", [
          a.user.id,
        ])
      ).rows[0].count,
    ),
    before,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM security_events WHERE user_id=$1 AND event='login_success'",
        [a.user.id],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (await post("/v1/auth/otp/verify", { email: a.user.email, code }))
      .statusCode,
    200,
  );
  const rows = (
    await pool.query(
      "SELECT encrypted_body FROM notification_outbox WHERE user_id=$1 AND subject='Chix security activity'",
      [a.user.id],
    )
  ).rows;
  assert.equal(rows.length, 1);
  assert.match(decryptMail(rows[0].encrypted_body), /login success/);
});

test("OTP resends preserve aggregate guessing budget across sessions and purposes", async () => {
  const a = await account();
  const code = await otp(a, a.sid);
  const wrong = code === "000000" ? "999999" : "000000";
  for (let n = 0; n < 5; n++)
    assert.equal(
      (
        await post(
          "/v1/auth/otp/verify",
          { code: wrong, reauth: true },
          a.cookie,
        )
      ).statusCode,
      400,
    );
  const fresh = await otp(a);
  assert.equal(
    (await post("/v1/auth/otp/verify", { email: a.user.email, code: fresh }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await pool.query("SELECT otp_failed_attempts FROM users WHERE id=$1", [
        a.user.id,
      ])
    ).rows[0].otp_failed_attempts,
    5,
  );
});

test("recovery generation records device details only for the account owner", async () => {
  const a = await account(),
    b = await account();
  const agent = "Mozilla/5.0 Macintosh Version/18.0 Safari/605.1.15";
  const generated = await app.inject({
    method: "POST",
    url: "/v1/me/recovery-codes",
    payload: {},
    headers: { cookie: a.cookie, "user-agent": agent },
  });
  assert.equal(generated.statusCode, 200, generated.body);
  assert.equal(generated.json().codes.length, 8);
  const activity = await app.inject({
    url: "/v1/me/devices",
    headers: { cookie: a.cookie },
  });
  assert.equal(activity.statusCode, 200);
  const event = activity
    .json()
    .events.find(
      (e: { event: string }) => e.event === "recovery_codes_regenerated",
    );
  assert.equal(event.user_agent, agent);
  assert.ok(event.created_at);
  const other = await app.inject({
    url: "/v1/me/devices",
    headers: { cookie: b.cookie },
  });
  assert.ok(
    !other.json().events.some((e: { id: string }) => e.id === event.id),
  );
});
