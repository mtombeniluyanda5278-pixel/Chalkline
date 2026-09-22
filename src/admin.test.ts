import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "./app.js";
import { pool } from "./db.js";
import { config } from "./config.js";
import { bootstrapAdmin } from "./adminBootstrap.js";
import { transaction } from "./transactions.js";
import { hashToken, listSessions } from "./sessions.js";
import { registerVerifiedAccount } from "./testAccounts.js";
import { connectRedis, closeRedis, clearTestRateLimits } from "./rateLimit.js";

const app = await buildApp(),
  users: string[] = [];
before(connectRedis);
beforeEach(clearTestRateLimits);
after(async () => {
  await pool.query(
    "DELETE FROM admin_audit_log WHERE admin_user_id=ANY($1::uuid[])",
    [users],
  );
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await app.close();
  await closeRedis();
  await pool.end();
});
async function account(admin = false) {
  const suffix = randomUUID().slice(0, 8),
    email = `admin-test-${suffix}@example.com`;
  const r = await registerVerifiedAccount(app, {
    email,
    username: `a.${suffix}`,
    firstName: "Teacher",
    lastName: "PrivateSurname",
    country: "ZA",
    dateOfBirth: "2000-01-01",
    trustDevice: true,
  });
  const id = r.json().user.id;
  users.push(id);
  if (admin)
    await pool.query("UPDATE users SET role='admin' WHERE id=$1", [id]);
  const cookie = [r.headers["set-cookie"]]
    .flat()
    .filter(Boolean)
    .map((c) => c!.split(";")[0])
    .join("; ");
  const token = /chalkline_session=([^;]+)/.exec(cookie)![1]!;
  const sessionId = (
    await pool.query("SELECT id FROM sessions WHERE token_hash=$1", [
      hashToken(token),
    ])
  ).rows[0].id;
  return { id, email, cookie, sessionId };
}
const feedback = {
  category: "bug",
  message: "A useful description of a problem.",
};

test("operational admin bootstrap audits promotion, revokes sessions, and rejects ineligible accounts", async () => {
  const user = await account();
  await pool.query("UPDATE users SET email_verified_at=NULL WHERE id=$1", [
    user.id,
  ]);
  await assert.rejects(
    transaction((c) =>
      bootstrapAdmin(c, user.id, "Verified operator support request"),
    ),
  );
  assert.equal(
    (await pool.query("SELECT role FROM users WHERE id=$1", [user.id])).rows[0]
      .role,
    "user",
  );
  await pool.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
    user.id,
  ]);
  assert.equal(
    await transaction((c) =>
      bootstrapAdmin(c, user.id, "Verified operator support request"),
    ),
    true,
  );
  assert.equal(
    (await app.inject({ url: "/v1/me", headers: { cookie: user.cookie } }))
      .statusCode,
    401,
  );
  assert.equal(
    await transaction((c) =>
      bootstrapAdmin(c, user.id, "Repeated operator support request"),
    ),
    false,
  );
  const audit = (
    await pool.query(
      "SELECT action,metadata FROM admin_audit_log WHERE admin_user_id=$1",
      [user.id],
    )
  ).rows;
  assert.deepEqual(audit, [
    {
      action: "admin_bootstrap",
      metadata: {
        reason: "Verified operator support request",
        source: "operator_cli",
      },
    },
  ]);
});

test("feedback never acknowledges a transaction that fails to commit", async (t) => {
  const user = await account();
  const connect = pool.connect.bind(pool) as (...args: any[]) => any;
  const mocked = t.mock.method(pool, "connect", ((...args: any[]) => {
    const result = connect(...args);
    // pool.query uses the callback overload; intercept transaction clients only.
    if (args.length) return result;
    return result.then((client: any) => {
      const query = client.query,
        release = client.release;
      client.query = function (...params: any[]) {
        if (params[0] === "COMMIT")
          return Promise.reject(new Error("Simulated commit failure"));
        return query.apply(client, params);
      };
      client.release = function (...params: any[]) {
        client.query = query;
        client.release = release;
        return release.apply(client, params);
      };
      return client;
    });
  }) as typeof pool.connect);
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { cookie: user.cookie },
      payload: feedback,
    });
    assert.equal(response.statusCode, 500, response.body);
  } finally {
    mocked.mock.restore();
  }
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM feedback WHERE user_id=$1",
        [user.id],
      )
    ).rows[0].n,
    0,
  );
});

test("mandatory admin passkey policy rejects password sessions and admin status does not grant document access", async () => {
  const admin = await account(true),
    user = await account();
  const old = config.ADMIN_REQUIRE_PASSKEY;
  config.ADMIN_REQUIRE_PASSKEY = true;
  try {
    assert.equal(
      (
        await app.inject({
          url: "/v1/admin/users",
          headers: { cookie: admin.cookie },
        })
      ).statusCode,
      403,
    );
    await pool.query("UPDATE sessions SET auth_method='passkey' WHERE id=$1", [
      admin.sessionId,
    ]);
    assert.equal(
      (
        await app.inject({
          url: "/v1/admin/users",
          headers: { cookie: admin.cookie },
        })
      ).statusCode,
      200,
    );
  } finally {
    config.ADMIN_REQUIRE_PASSKEY = old;
  }
  const document = await app.inject({
    method: "POST",
    url: "/v1/documents",
    headers: { cookie: user.cookie },
    payload: {
      kind: "note",
      title: "Private lesson",
      content: { body: "Private teacher text" },
    },
  });
  assert.equal(document.statusCode, 201, document.body);
  assert.equal(
    (
      await app.inject({
        url: `/v1/documents/${document.json().item.id}`,
        headers: { cookie: admin.cookie },
      })
    ).statusCode,
    404,
  );
});

test("every admin route rejects guests and ordinary users", async () => {
  const user = await account(),
    id = randomUUID();
  const routes = [
    ["GET", "/v1/admin/users"],
    ["POST", "/v1/admin/emails/preview"],
    ["POST", `/v1/admin/emails/${id}/send`],
    ["GET", "/v1/admin/feedback"],
    ["GET", "/v1/admin/jobs"],
    ["POST", `/v1/admin/users/${id}/contact`],
    ["POST", `/v1/admin/users/${id}/suspension`],
    ["PATCH", `/v1/admin/feedback/${id}`],
    ["POST", `/v1/admin/jobs/${id}/retry`],
  ] as const;
  for (const [method, url] of routes) {
    assert.equal((await app.inject({ method, url })).statusCode, 401, url);
    assert.equal(
      (await app.inject({ method, url, headers: { cookie: user.cookie } }))
        .statusCode,
      403,
      url,
    );
  }
  const promotion = await app.inject({
    method: "PATCH",
    url: "/v1/me/preferences",
    headers: { cookie: user.cookie },
    payload: { role: "admin" },
  });
  assert.equal(promotion.statusCode, 400);
  assert.equal(
    (await pool.query("SELECT role FROM users WHERE id=$1", [user.id])).rows[0]
      .role,
    "user",
  );
});

test("admin list masks contact details and contact reveal requires fresh auth and an audit reason", async () => {
  const admin = await account(true),
    user = await account();
  const list = await app.inject({
    url: "/v1/admin/users",
    headers: { cookie: admin.cookie },
  });
  assert.equal(list.statusCode, 200, list.body);
  const item = list
    .json()
    .items.find((row: { id: string }) => row.id === user.id);
  assert.ok(item);
  assert.notEqual(item.email, user.email);
  for (const field of [
    "last_name",
    "recovery_email",
    "date_of_birth",
    "password_hash",
    "address",
  ])
    assert.equal(item[field], undefined);
  const url = `/v1/admin/users/${user.id}/contact`;
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url,
        headers: { cookie: admin.cookie },
        payload: { reason: "short" },
      })
    ).statusCode,
    400,
  );
  const reason = "Support request for this account";
  const reveal = await app.inject({
    method: "POST",
    url,
    headers: { cookie: admin.cookie },
    payload: { reason },
  });
  assert.equal(reveal.statusCode, 200, reveal.body);
  assert.equal(reveal.json().email, user.email);
  const audit = (
    await pool.query(
      "SELECT target_user_id,metadata FROM admin_audit_log WHERE admin_user_id=$1 AND action='contact_reveal'",
      [admin.id],
    )
  ).rows;
  assert.deepEqual(audit, [{ target_user_id: user.id, metadata: { reason } }]);
  await pool.query(
    "UPDATE sessions SET reauthenticated_at=now()-interval '6 minutes' WHERE id=$1",
    [admin.sessionId],
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url,
        headers: { cookie: admin.cookie },
        payload: { reason },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM admin_audit_log WHERE admin_user_id=$1",
        [admin.id],
      )
    ).rows[0].n,
    1,
  );
});

test("admin idle policy applies to existing sessions and active-session listings without shortening educator sessions", async () => {
  const admin = await account(true),
    user = await account();
  await pool.query(
    "UPDATE sessions SET last_active_at=now()-($2::int*interval '1 minute') WHERE id=ANY($1::uuid[])",
    [[admin.sessionId, user.sessionId], config.ADMIN_IDLE_MAX_MINUTES + 1],
  );
  assert.equal(
    (await app.inject({ url: "/v1/me", headers: { cookie: admin.cookie } }))
      .statusCode,
    401,
  );
  assert.deepEqual(await listSessions(admin.id), []);
  assert.equal(
    (await app.inject({ url: "/v1/me", headers: { cookie: user.cookie } }))
      .statusCode,
    200,
  );
});

test("suspension revokes sessions, is audited, rejects self-suspension and does not revive old cookies", async () => {
  const admin = await account(true),
    user = await account();
  const suspend = (id: string, suspended: boolean) =>
    app.inject({
      method: "POST",
      url: `/v1/admin/users/${id}/suspension`,
      headers: { cookie: admin.cookie },
      payload: { suspended, reason: "Confirmed account abuse report" },
    });
  assert.equal((await suspend(admin.id, true)).statusCode, 400);
  assert.equal((await suspend(user.id, true)).statusCode, 200);
  assert.equal(
    (await app.inject({ url: "/v1/me", headers: { cookie: user.cookie } }))
      .statusCode,
    401,
  );
  assert.equal((await suspend(user.id, false)).statusCode, 200);
  assert.equal(
    (await app.inject({ url: "/v1/me", headers: { cookie: user.cookie } }))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM admin_audit_log WHERE admin_user_id=$1 AND action='suspension'",
        [admin.id],
      )
    ).rows[0].n,
    2,
  );
});

test("feedback discards unconsented diagnostics, validates opted-in fields, and enforces ownership", async () => {
  const user = await account(),
    other = await account();
  const send = (payload: object) =>
    app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { cookie: user.cookie },
      payload: { ...feedback, ...payload },
    });
  const r = await send({
    diagnostics: { cookies: "must never be stored", note: "private text" },
  });
  assert.equal(r.statusCode, 201, r.body);
  const id = r.json().item.id;
  assert.equal(
    (await pool.query("SELECT diagnostics FROM feedback WHERE id=$1", [id]))
      .rows[0].diagnostics,
    null,
  );
  assert.equal(
    (
      await send({
        includeDiagnostics: true,
        diagnostics: { cookies: "forbidden" },
      })
    ).statusCode,
    400,
  );
  const diagnostics = {
    appVersion: "0.1.0",
    route: "feedback",
    browser: "Other",
    os: "Other",
    viewport: { width: 1000, height: 800 },
    timestamp: new Date().toISOString(),
  };
  const valid = await send({ includeDiagnostics: true, diagnostics });
  assert.equal(valid.statusCode, 201, valid.body);
  assert.deepEqual(
    (
      await pool.query("SELECT diagnostics FROM feedback WHERE id=$1", [
        valid.json().item.id,
      ])
    ).rows[0].diagnostics,
    diagnostics,
  );
  assert.equal(
    (
      await app.inject({
        url: `/v1/feedback/${id}`,
        headers: { cookie: other.cookie },
      })
    ).statusCode,
    404,
  );
  const own = await app.inject({
    url: `/v1/feedback/${id}`,
    headers: { cookie: user.cookie },
  });
  assert.equal(own.statusCode, 200);
  assert.equal(own.json().item.diagnostics, undefined);
});

test("admin audience filters and email previews queue only confirmed snapshot recipients once", async () => {
  const admin = await account(true),
    first = await account(),
    second = await account();
  await pool.query(
    "UPDATE users SET created_at='2001-02-03T12:00:00Z',marketing_announcements=(id=$2) WHERE id=ANY($1::uuid[])",
    [[first.id, second.id], first.id],
  );
  const filters = {
    createdFrom: "2001-02-03",
    createdTo: "2001-02-03",
    plan: "FREE_BETA",
    ageMin: 18,
    ageMax: 100,
    storageMaxMb: 1,
    usageMaxPct: 1,
  };
  const headers = { cookie: admin.cookie };
  const list = await app.inject({
    url:
      "/v1/admin/users?" +
      new URLSearchParams({ filters: JSON.stringify(filters) }),
    headers,
  });
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(list.json().total, 2);
  assert.ok(list.json().plans.includes("FREE_BETA"));
  const beforeCount = Number(
    (
      await pool.query(
        "SELECT count(*) FROM notification_outbox WHERE dedupe_key LIKE 'campaign:%'",
      )
    ).rows[0].count,
  );
  const preview = await app.inject({
    method: "POST",
    url: "/v1/admin/emails/preview",
    headers,
    payload: {
      filters,
      kind: "service",
      subject: "Service test",
      message: "A test service update.",
    },
  });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.json().count, 2);
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT count(*) FROM notification_outbox WHERE dedupe_key LIKE 'campaign:%'",
        )
      ).rows[0].count,
    ),
    beforeCount,
  );
  assert.ok(
    preview
      .json()
      .sample.every((row: { email: string }) => row.email.includes("*")),
  );
  const announcement = await app.inject({
    method: "POST",
    url: "/v1/admin/emails/preview",
    headers,
    payload: {
      filters,
      kind: "announcement",
      subject: "Announcement",
      message: "A test announcement.",
    },
  });
  assert.equal(announcement.json().count, 1);
  const url = `/v1/admin/emails/${preview.json().id}/send`;
  const denied = await app.inject({
    method: "POST",
    url,
    headers: { cookie: first.cookie },
  });
  assert.equal(denied.statusCode, 403);
  await pool.query("UPDATE users SET suspended_at=now() WHERE id=$1", [
    second.id,
  ]);
  const sent = await app.inject({ method: "POST", url, headers });
  assert.equal(sent.statusCode, 200, sent.body);
  assert.equal(sent.json().queued, 1);
  assert.equal(sent.json().skipped, 1);
  const retry = await app.inject({ method: "POST", url, headers });
  assert.equal(retry.json().alreadyQueued, true);
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT count(*) FROM notification_outbox WHERE dedupe_key=$1",
          [`campaign:${preview.json().id}:${first.id}`],
        )
      ).rows[0].count,
    ),
    1,
  );
  await pool.query(
    "UPDATE admin_email_campaigns SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [announcement.json().id],
  );
  const expired = await app.inject({
    method: "POST",
    url: `/v1/admin/emails/${announcement.json().id}/send`,
    headers,
  });
  assert.equal(expired.statusCode, 409);
  const invalid = await app.inject({
    url:
      "/v1/admin/users?" +
      new URLSearchParams({
        filters: JSON.stringify({ ageMin: 40, ageMax: 20 }),
      }),
    headers,
  });
  assert.equal(invalid.statusCode, 400);
});
