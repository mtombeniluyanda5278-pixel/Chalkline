import { registerVerifiedAccount, verificationToken } from "./testAccounts.js";
import { objectStore } from "./storage.js";
import { buckets, consumeRateLimit } from "./rateLimit.js";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  S3Client,
  CreateBucketCommand,
  ListObjectsV2Command,
  PutBucketVersioningCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { buildApp } from "./app.js";
import { pool } from "./db.js";
import { connectRedis, closeRedis, clearTestRateLimits } from "./rateLimit.js";
import { createOneTimeToken, hashToken } from "./sessions.js";
import { config } from "./config.js";
import { validateFile, safeFilename } from "./fileValidation.js";
import { runScanJobs } from "./scanJobs.js";
import { runMaintenance } from "./worker.js";
import { encryptMail, decryptMail } from "./mail.js";
const app = await buildApp();
const users: string[] = [];
const s3 = config.STORAGE_ENDPOINT
  ? new S3Client({
      endpoint: config.STORAGE_ENDPOINT,
      region: config.STORAGE_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.STORAGE_ACCESS_KEY_ID!,
        secretAccessKey: config.STORAGE_SECRET_ACCESS_KEY!,
      },
    })
  : null;
before(async () => {
  await connectRedis();
  await pool.query("SELECT 1");
  if (s3) {
    await s3.send(new CreateBucketCommand({ Bucket: config.STORAGE_BUCKET }));
    await s3.send(
      new PutBucketVersioningCommand({
        Bucket: config.STORAGE_BUCKET,
        VersioningConfiguration: { Status: "Enabled" },
      }),
    );
  }
});
beforeEach(async () => {
  await clearTestRateLimits();
});
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await runMaintenance();
  await app.close();
  await closeRedis();
  await pool.end();
  s3?.destroy();
});
function cookies(response: { headers: Record<string, unknown> }) {
  const h = response.headers["set-cookie"];
  return (Array.isArray(h) ? h : [h])
    .filter(Boolean)
    .map((v) => String(v).split(";")[0])
    .join("; ");
}
async function account(verified = false) {
  const suffix = randomUUID().slice(0, 8),
    email = `test-${suffix}@example.com`,
    password = "correct horse battery staple";
  const r = await registerVerifiedAccount(app, {
      trustDevice: true,
      firstName: "Teacher",
      lastName: "Test",
      country: "ZA",
      dateOfBirth: "2000-01-01",
      email,
      password,
      confirmPassword: password,
      username: "t." + suffix,
      phone: "+27821234567",
      address: {
        line1: "1 Test Road",
        city: "Cape Town",
        postalCode: "8001",
        country: "ZA",
      },
    });
  assert.equal(r.statusCode, 201, r.body);
  const id = r.json().user.id;
  users.push(id);
  if (!verified) await pool.query("UPDATE users SET email_verified_at=NULL WHERE id=$1", [id]);
  if (verified)
    await pool.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
      id,
    ]);
  return { id, email, password, cookie: cookies(r) };
}
async function doc(cookie: string, kind = "note") {
  const r = await app.inject({
    method: "POST",
    url: "/v1/documents",
    headers: { cookie },
    payload: {
      kind,
      title: "Climate notes",
      content: { body: "Mid-latitude cyclones" },
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().item;
}
function upload(
  cookie: string,
  name = "lesson.txt",
  content = Buffer.from("Teaching resource"),
  mime = "text/plain",
) {
  const boundary = "chalkline-test-boundary";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: "POST",
    url: "/v1/resources",
    headers: {
      cookie,
      "content-type": "multipart/form-data; boundary=" + boundary,
    },
    payload: body,
  });
}

test("documents enforce owner access and reject mass assignment", async () => {
  const a = await account(),
    b = await account(),
    item = await doc(a.cookie);
  for (const method of ["GET", "PATCH", "DELETE"] as const) {
    const r = await app.inject({
      method,
      url: "/v1/documents/" + item.id,
      headers: { cookie: b.cookie },
      ...(method === "PATCH"
        ? { payload: { title: "stolen", content: {}, revision: 1 } }
        : method === "DELETE"
          ? { payload: { revision: 1 } }
          : {}),
    });
    assert.ok([404, 409].includes(r.statusCode), r.body);
  }
  const r = await app.inject({
    method: "POST",
    url: "/v1/documents",
    headers: { cookie: a.cookie },
    payload: { kind: "note", title: "test", content: {}, user_id: b.id },
  });
  assert.equal(r.statusCode, 400);
  const invalid = await app.inject({
    method: "GET",
    url: "/v1/documents/not-a-uuid",
    headers: { cookie: a.cookie },
  });
  assert.equal(invalid.statusCode, 400);
});
test("concurrent autosaves permit exactly one revision and keep history", async () => {
  const a = await account(),
    item = await doc(a.cookie);
  const results = await Promise.all(
    ["Tab one", "Tab two"].map((title) =>
      app.inject({
        method: "PATCH",
        url: "/v1/documents/" + item.id,
        headers: { cookie: a.cookie },
        payload: { title, content: { body: title }, revision: 1 },
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
  const history = await app.inject({
    method: "GET",
    url: "/v1/documents/" + item.id + "/revisions",
    headers: { cookie: a.cookie },
  });
  assert.equal(history.json().items[0].content.body, "Mid-latitude cyclones");
});
test("resume persists exact editor state and cannot point at another owner", async () => {
  const a = await account(),
    b = await account(),
    item = await doc(a.cookie);
  const state = {
    cursor: 14,
    selectionEnd: 18,
    scroll: 120,
    field: "body",
    page: 14,
    section: "Cyclones",
  };
  const put = await app.inject({
    method: "PUT",
    url: "/v1/resume/" + item.id,
    headers: { cookie: a.cookie },
    payload: { kind: "document", state },
  });
  assert.equal(put.statusCode, 200, put.body);
  const get = await app.inject({
    method: "GET",
    url: "/v1/documents/" + item.id,
    headers: { cookie: a.cookie },
  });
  assert.deepEqual(get.json().resume, state);
  const bad = await app.inject({
    method: "PUT",
    url: "/v1/resume/" + item.id,
    headers: { cookie: b.cookie },
    payload: { kind: "document", state },
  });
  assert.equal(bad.statusCode, 404);
});
test("templates create independent lessons and schedule/search reflect planned dates", async () => {
  const a = await account(),
    template = await doc(a.cookie, "template");
  const copy = await app.inject({
    method: "POST",
    url: "/v1/documents/" + template.id + "/copy",
    headers: { cookie: a.cookie },
    payload: { kind: "lesson", title: "Monday geography" },
  });
  assert.equal(copy.statusCode, 201);
  const id = copy.json().item.id;
  assert.notEqual(id, template.id);
  const update = await app.inject({
    method: "PATCH",
    url: "/v1/documents/" + id,
    headers: { cookie: a.cookie },
    payload: {
      title: "Monday geography",
      content: {
        subject: "Geography",
        grade: "10",
        teachingActivities: "Discuss cyclones",
      },
      plannedDate: "2026-09-14",
      revision: 1,
    },
  });
  assert.equal(update.statusCode, 200);
  const schedule = await app.inject({
    method: "GET",
    url: "/v1/documents?kind=lesson&date=2026-09-14&subject=Geography",
    headers: { cookie: a.cookie },
  });
  assert.equal(schedule.json().items[0].id, id);
});
test("CSRF origin checks reject foreign mutations before any account operation", async () => {
  const r = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { origin: "https://evil.example" },
    payload: { email: "x@example.com", password: "password" },
  });
  assert.equal(r.statusCode, 403);
  const fetchSite = await app.inject({
    method: "POST",
    url: "/v1/auth/logout",
    headers: { "sec-fetch-site": "cross-site" },
  });
  assert.equal(fetchSite.statusCode, 403);
});
test("unknown browser gets no session; approval requires trust, matching number and single-use completion", async () => {
  const a = await account();
  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email: a.email, password: a.password },
  });
  assert.equal(login.statusCode, 202, login.body);
  assert.doesNotMatch(cookies(login), /chalkline_session=/);
  const pendingCookie = cookies(login);
  const noAccess = await app.inject({
    method: "GET",
    url: "/v1/me",
    headers: { cookie: pendingCookie },
  });
  assert.equal(noAccess.statusCode, 401);
  const list = await app.inject({
    method: "GET",
    url: "/v1/me/devices",
    headers: { cookie: a.cookie },
  });
  const request = list.json().pending[0];
  assert.equal(request.matching_number, undefined);
  const approve = (number: number) =>
    app.inject({
      method: "POST",
      url: "/v1/me/devices/requests/" + request.id,
      headers: { cookie: a.cookie },
      payload: { decision: "approve", number },
    });
  assert.equal(
    (await approve(login.json().number === 99 ? 98 : 99)).statusCode,
    400,
  );
  assert.equal((await approve(login.json().number)).statusCode, 200);
  const completed = await app.inject({
    method: "POST",
    url: "/v1/devices/complete",
    headers: { cookie: pendingCookie },
  });
  assert.equal(completed.statusCode, 200, completed.body);
  assert.match(cookies(completed), /chalkline_session=/);
  const replay = await app.inject({
    method: "POST",
    url: "/v1/devices/complete",
    headers: { cookie: pendingCookie },
  });
  assert.equal(replay.statusCode, 401);
});
test("device challenges expire and cross-user approval fails", async () => {
  const a = await account(),
    b = await account();
  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email: a.email, password: a.password },
  });
  const request = (
    await pool.query(
      "SELECT id FROM device_challenges WHERE user_id=$1 AND status='pending'",
      [a.id],
    )
  ).rows[0];
  const cross = await app.inject({
    method: "POST",
    url: "/v1/me/devices/requests/" + request.id,
    headers: { cookie: b.cookie },
    payload: { decision: "approve", number: login.json().number },
  });
  assert.equal(cross.statusCode, 404);
  await pool.query(
    "UPDATE device_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",
    [request.id],
  );
  const expired = await app.inject({
    method: "GET",
    url: "/v1/devices/pending",
    headers: { cookie: cookies(login) },
  });
  assert.equal(expired.statusCode, 401);
});
test("recovery code is single-use and revokes old trusted sessions", async () => {
  const a = await account();
  const codes = await app.inject({
    method: "POST",
    url: "/v1/me/recovery-codes",
    headers: { cookie: a.cookie },
  });
  assert.equal(codes.statusCode, 200);
  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email: a.email, password: a.password },
  });
  const pendingCookie = cookies(login);
  const recover = await app.inject({
    method: "POST",
    url: "/v1/devices/recovery/confirm",
    headers: { cookie: pendingCookie },
    payload: { token: codes.json().codes[0] },
  });
  assert.equal(recover.statusCode, 200, recover.body);
  const old = await app.inject({
    method: "GET",
    url: "/v1/me",
    headers: { cookie: a.cookie },
  });
  assert.equal(old.statusCode, 401);
  assert.equal(
    (
      await pool.query(
        "SELECT * FROM recovery_codes WHERE user_id=$1 AND token_hash=$2",
        [a.id, hashToken(codes.json().codes[0])],
      )
    ).rowCount,
    0,
  );
});
test("password reset is atomic, rejects replay and invalidates sessions and pending challenges", async () => {
  const a = await account();
  await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email: a.email, password: a.password },
  });
  const token = await createOneTimeToken(a.id, "reset_password");
  const reset = () =>
    app.inject({
      method: "POST",
      url: "/v1/auth/password-reset/confirm",
      payload: {
        token,
        password: "a different secure password",
        confirmPassword: "a different secure password",
      },
    });
  assert.equal((await reset()).statusCode, 200);
  assert.equal((await reset()).statusCode, 400);
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { cookie: a.cookie },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT * FROM device_challenges WHERE user_id=$1 AND status='pending'",
        [a.id],
      )
    ).rowCount,
    0,
  );
});
test("verification cannot verify a changed email and older tokens are invalidated", async () => {
  const a = await account(),
    old = await createOneTimeToken(a.id, "verify_email"),
    fresh = await createOneTimeToken(a.id, "verify_email");
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/auth/verify-email",
        payload: { token: old },
      })
    ).statusCode,
    400,
  );
  await pool.query("UPDATE users SET email=$2 WHERE id=$1", [
    a.id,
    "changed-" + randomUUID() + "@example.com",
  ]);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/auth/verify-email",
        payload: { token: fresh },
      })
    ).statusCode,
    400,
  );
});
test("upload validation rejects active formats, spoofed MIME and unsafe names", async () => {
  await assert.rejects(
    validateFile(
      Buffer.from('<svg onload="alert(1)"/>'),
      "image.svg",
      "image/svg+xml",
    ),
  );
  await assert.rejects(
    validateFile(
      Buffer.from("<html>attack</html>"),
      "lesson.txt",
      "text/plain",
    ),
  );
  await assert.rejects(
    validateFile(Buffer.from("not a PDF"), "lesson.pdf", "application/pdf"),
  );
  await assert.rejects(
    validateFile(
      Buffer.from("PKfake"),
      "lesson.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
  );
  assert.equal(safeFilename("../../file\r\n.txt"), ".._.._file__.txt");
});
test(
  "private file lifecycle, ownership, attachment constraints and deletion outbox",
  { skip: !s3 },
  async () => {
    const a = await account(true),
      b = await account(),
      lesson = await doc(a.cookie, "lesson");
    const r = await upload(a.cookie);
    assert.equal(r.statusCode, 202, r.body);
    const id = r.json().item.id;
    for (const route of ["download", "content", "preview"]) {
      const pending = await app.inject({
        method: "GET",
        url: `/v1/resources/${id}/${route}`,
        headers: { cookie: a.cookie },
      });
      assert.equal(pending.statusCode, 404, pending.body);
    }
    await runScanJobs();
    const get = await app.inject({
      method: "GET",
      url: "/v1/resources/" + id + "/download",
      headers: { cookie: a.cookie },
    });
    assert.equal(get.statusCode, 200);
    assert.match(String(get.headers["content-disposition"]), /^attachment/);
    assert.equal(get.body, "Teaching resource");
    for (const url of [
      `/v1/resources/${id}`,
      `/v1/resources/${id}/download`,
      `/v1/resources/${id}/preview`,
    ])
      assert.equal(
        (
          await app.inject({
            method: "GET",
            url,
            headers: { cookie: b.cookie },
          })
        ).statusCode,
        404,
      );
    const attach = await app.inject({
      method: "PUT",
      url: `/v1/documents/${lesson.id}/resources/${id}`,
      headers: { cookie: a.cookie },
    });
    assert.equal(attach.statusCode, 200);
    const other = await doc(b.cookie, "lesson");
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: `/v1/documents/${other.id}/resources/${id}`,
          headers: { cookie: b.cookie },
        })
      ).statusCode,
      404,
    );
    const key = (
      await pool.query("SELECT object_key FROM resources WHERE id=$1", [id])
    ).rows[0].object_key;
    await s3!.send(
      new PutObjectCommand({
        Bucket: config.STORAGE_BUCKET,
        Key: key,
        Body: "second stored version",
      }),
    );
    const deleted = await app.inject({
      method: "DELETE",
      url: "/v1/me",
      headers: { cookie: a.cookie },
      payload: { password: a.password },
    });
    assert.equal(deleted.statusCode, 200, deleted.body);
    assert.equal(
      (
        await pool.query("SELECT * FROM object_deletions WHERE object_key=$1", [
          key,
        ])
      ).rowCount,
      1,
    );
    await runMaintenance();
    const objects = await s3!.send(
      new ListObjectsV2Command({ Bucket: config.STORAGE_BUCKET, Prefix: key }),
    );
    assert.equal(objects.KeyCount, 0);
    const versions = await s3!.send(
      new ListObjectVersionsCommand({
        Bucket: config.STORAGE_BUCKET,
        Prefix: key,
      }),
    );
    assert.equal(versions.Versions?.length ?? 0, 0);
    assert.equal(versions.DeleteMarkers?.length ?? 0, 0);
    for (const table of [
      "documents",
      "resources",
      "trusted_devices",
      "device_challenges",
      "security_events",
      "resume_state",
    ])
      assert.equal(
        (
          await pool.query(`SELECT count(*) FROM ${table} WHERE user_id=$1`, [
            a.id,
          ])
        ).rows[0].count,
        "0",
      );
  },
);
test("notification encryption authenticates payloads without revealing token contents", () => {
  const plaintext = "secret reset token " + randomUUID(),
    ciphertext = encryptMail(plaintext);
  assert.ok(!ciphertext.includes(plaintext));
  assert.equal(decryptMail(ciphertext), plaintext);
  const b = Buffer.from(ciphertext, "base64");
  b[30] = b[30]! ^ 1;
  assert.throws(() => decryptMail(b.toString("base64")));
});

test("expired sessions and credential-generation changes invalidate old cookies", async () => {
  const a = await account();
  await pool.query(
    "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
    [a.id],
  );
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { cookie: a.cookie },
      })
    ).statusCode,
    401,
  );
  const b = await account();
  await pool.query("UPDATE users SET auth_epoch=auth_epoch+1 WHERE id=$1", [
    b.id,
  ]);
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { cookie: b.cookie },
      })
    ).statusCode,
    401,
  );
});
test("recent-auth gates sensitive changes and explicit password reauthentication restores access", async () => {
  const a = await account();
  await pool.query(
    "UPDATE sessions SET reauthenticated_at=now()-interval '1 hour' WHERE user_id=$1",
    [a.id],
  );
  const denied = await app.inject({
    method: "POST",
    url: "/v1/me/recovery-codes",
    headers: { cookie: a.cookie },
  });
  assert.equal(denied.json().code, "REAUTH_REQUIRED");
  const reauth = await app.inject({
    method: "POST",
    url: "/v1/auth/reauth",
    headers: { cookie: a.cookie },
    payload: { password: a.password },
  });
  assert.equal(reauth.statusCode, 200);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/me/recovery-codes",
        headers: { cookie: a.cookie },
      })
    ).statusCode,
    200,
  );
});
test(
  "upload limits reject oversized resources before persistence",
  { skip: !s3 },
  async () => {
    const a = await account(true);
    const r = await upload(
      a.cookie,
      "large.txt",
      Buffer.alloc(config.UPLOAD_MAX_BYTES + 1, 65),
    );
    assert.equal(r.statusCode, 413, r.body);
    assert.equal(
      (
        await pool.query("SELECT count(*) FROM resources WHERE user_id=$1", [
          a.id,
        ])
      ).rows[0].count,
      "0",
    );
  },
);
test("calendar dates round-trip without a timezone shift", async () => {
  const a = await account(),
    item = await doc(a.cookie, "lesson");
  const result = await app.inject({
    method: "PATCH",
    url: "/v1/documents/" + item.id,
    headers: { cookie: a.cookie },
    payload: {
      title: "Morning lesson",
      revision: 1,
      content: {},
      plannedDate: "2026-09-14",
    },
  });
  assert.equal(result.json().item.planned_date, "2026-09-14");
});
test("email-token issuance rejects a stale recipient", async () => {
  const a = await account();
  await pool.query("UPDATE users SET email=$2 WHERE id=$1", [
    a.id,
    "new-" + randomUUID() + "@example.com",
  ]);
  await assert.rejects(createOneTimeToken(a.id, "reset_password", a.email));
});

test(
  "storage deletion failures remain queued and are retried",
  { skip: !s3 },
  async () => {
    const a = await account(true);
    const r = await upload(a.cookie);
    assert.equal(r.statusCode, 202, r.body);
    await runScanJobs();
    const id = r.json().item.id,
      key = (
        await pool.query("SELECT object_key FROM resources WHERE id=$1", [id])
      ).rows[0].object_key;
    await app.inject({
      method: "DELETE",
      url: "/v1/resources/" + id,
      headers: { cookie: a.cookie },
    });
    const purged = await app.inject({
      method: "DELETE",
      url: `/v1/trash/resources/${id}`,
      headers: { cookie: a.cookie },
    });
    assert.equal(purged.statusCode, 200, purged.body);
    const store = objectStore(),
      original = store.delete;
    try {
      store.delete = async () => {
        throw new Error("simulated storage outage");
      };
      await runMaintenance();
    } finally {
      store.delete = original;
    }
    assert.ok(
      (
        await pool.query(
          "SELECT attempts FROM object_deletions WHERE object_key=$1",
          [key],
        )
      ).rows[0].attempts >= 1,
    );
    await pool.query(
      "UPDATE object_deletions SET available_at=now() WHERE object_key=$1",
      [key],
    );
    await runMaintenance();
    const versions = await s3!.send(
      new ListObjectVersionsCommand({
        Bucket: config.STORAGE_BUCKET,
        Prefix: key,
      }),
    );
    assert.equal(versions.Versions?.length ?? 0, 0);
  },
);
test("upload abuse bucket blocks requests independently of the global limit", async () => {
  const a = await account(true);
  for (let i = 0; i < buckets.upload.max; i++)
    await consumeRateLimit("upload", a.id);
  const response = await upload(a.cookie);
  assert.equal(response.statusCode, 429);
});

test(
  "quarantined files keep their purge deadline after moving to Trash",
  { skip: !s3 },
  async () => {
    const a = await account(true);
    const uploaded = await upload(
      a.cookie,
      "unsafe.html",
      Buffer.from("<script>alert(1)</script>"),
      "text/html",
    );
    assert.equal(uploaded.statusCode, 202, uploaded.body);
    const id = uploaded.json().item.id;
    await runScanJobs();
    const row = (
      await pool.query("SELECT status,object_key FROM resources WHERE id=$1", [
        id,
      ])
    ).rows[0];
    assert.equal(row.status, "quarantined");
    const trashed = await app.inject({
      method: "DELETE",
      url: `/v1/resources/${id}`,
      headers: { cookie: a.cookie },
    });
    assert.equal(trashed.statusCode, 200, trashed.body);
    const restore = await app.inject({
      method: "POST",
      url: `/v1/trash/resources/${id}/restore`,
      headers: { cookie: a.cookie },
    });
    assert.equal(restore.statusCode, 404);
    await pool.query(
      "UPDATE resources SET scanned_at=now()-(($2::int+1)*interval '1 hour') WHERE id=$1",
      [id, config.MALWARE_QUARANTINE_RETENTION_HOURS],
    );
    await runMaintenance();
    assert.equal(
      (await pool.query("SELECT id FROM resources WHERE id=$1", [id])).rowCount,
      0,
    );
    const versions = await s3!.send(
      new ListObjectVersionsCommand({
        Bucket: config.STORAGE_BUCKET,
        Prefix: row.object_key,
      }),
    );
    assert.equal(versions.Versions?.length ?? 0, 0);
  },
);
test(
  "unverified accounts cannot reserve file storage",
  { skip: !s3 },
  async () => {
    const a = await account();
    const response = await upload(a.cookie);
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(
      (await pool.query("SELECT id FROM resources WHERE user_id=$1", [a.id]))
        .rowCount,
      0,
    );
  },
);
