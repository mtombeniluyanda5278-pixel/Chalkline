import {
  registerVerifiedAccount,
  verificationToken,
  enrollAuthenticator,
  totpLogin,
} from "./testAccounts.js";
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
import { scanLease } from "./concurrency.js";
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
    // The bucket survives between runs, so creating it is best-effort; only a
    // genuine failure should stop the suite.
    try {
      await s3.send(new CreateBucketCommand({ Bucket: config.STORAGE_BUCKET }));
    } catch (error) {
      const name = (error as { name?: string })?.name ?? "";
      if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists")
        throw error;
    }
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
  if (!verified)
    await pool.query("UPDATE users SET email_verified_at=NULL WHERE id=$1", [
      id,
    ]);
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

test(
  "scan workers leave queued jobs untouched while global capacity is occupied",
  { skip: !s3 },
  async () => {
    const a = await account(true);
    const uploaded = await upload(a.cookie);
    assert.equal(uploaded.statusCode, 202, uploaded.body);
    const id = uploaded.json().item.id;
    const held: NonNullable<Awaited<ReturnType<typeof scanLease>>>[] = [];
    try {
      for (let i = 0; i < config.MAX_SCANS_GLOBAL; i++) {
        const lease = await scanLease();
        assert.ok(lease);
        held.push(lease);
      }
      await runScanJobs();
      const job = (
        await pool.query(
          "SELECT attempts,lease_until FROM jobs WHERE resource_id=$1",
          [id],
        )
      ).rows[0];
      assert.equal(job.attempts, 0);
      assert.equal(job.lease_until, null);
    } finally {
      await Promise.all(held.map((release) => release()));
    }
    await runScanJobs();
    assert.equal(
      (await pool.query("SELECT status FROM resources WHERE id=$1", [id]))
        .rows[0].status,
      "ready",
    );
    // Both successful and empty queue paths return every capacity slot.
    await runScanJobs();
    const slots: typeof held = [];
    try {
      for (let i = 0; i < config.MAX_SCANS_GLOBAL; i++) {
        const slot = await scanLease();
        assert.ok(slot);
        slots.push(slot);
      }
    } finally {
      await Promise.all(slots.map((release) => release()));
    }
  },
);

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
  const a = await account(true);
  const secret = await enrollAuthenticator(app, a.cookie);
  // No cookies on this request, so the server sees an unrecognised browser.
  const login = await totpLogin(app, a.email, secret);
  assert.equal(login.statusCode, 202, login.body);
  assert.equal(login.json().approvalRequired, true);
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
  const a = await account(true),
    b = await account(true);
  const secret = await enrollAuthenticator(app, a.cookie);
  const login = await totpLogin(app, a.email, secret);
  assert.equal(login.statusCode, 202, login.body);
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
// /v1/devices/recovery/confirm needs the pending-device cookie that only the
// device-challenge path sets, which TOTP login on an unknown browser now issues.
test("recovery code is single-use and revokes old trusted sessions", async () => {
  const a = await account(true);
  const secret = await enrollAuthenticator(app, a.cookie);
  const codes = await app.inject({
    method: "POST",
    url: "/v1/me/recovery-codes",
    headers: { cookie: a.cookie },
  });
  assert.equal(codes.statusCode, 200);
  const login = await totpLogin(app, a.email, secret);
  assert.equal(login.statusCode, 202, login.body);
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
test("verification cannot verify a changed email and older codes are invalidated", async () => {
  const a = await account();
  await pool.query("UPDATE users SET email_verified_at=NULL WHERE id=$1", [
    a.id,
  ]);
  const resend = () =>
    app.inject({
      method: "POST",
      url: "/v1/auth/verify-email/resend",
      payload: { email: a.email },
    });
  assert.equal((await resend()).statusCode, 200);
  const old = await verificationToken(a.email);
  assert.equal((await resend()).statusCode, 200);
  const fresh = await verificationToken(a.email);
  const active = (
    await pool.query(
      "SELECT count(*)::int AS n FROM email_tokens WHERE user_id=$1 AND purpose='verify_email' AND used_at IS NULL",
      [a.id],
    )
  ).rows[0];
  assert.equal(active.n, 1);
  if (old.code !== fresh.code)
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/verify-email",
          payload: old,
        })
      ).statusCode,
      400,
    );
  const changed = "changed-" + randomUUID() + "@example.com";
  await pool.query("UPDATE users SET email=$2 WHERE id=$1", [a.id, changed]);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/auth/verify-email",
        payload: fresh,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/auth/verify-email",
        payload: { ...fresh, email: changed },
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
    // runScanJobs() is bounded by global scan capacity, so one pass need not
    // reach this resource when the queue is busy. Drain until it is ready.
    for (let pass = 0; pass < 10; pass++) {
      await runScanJobs();
      const status = (
        await pool.query("SELECT status FROM resources WHERE id=$1", [id])
      ).rows[0]?.status;
      if (status === "ready") break;
    }
    const get = await app.inject({
      method: "GET",
      url: "/v1/resources/" + id + "/download",
      headers: { cookie: a.cookie },
    });
    assert.equal(get.statusCode, 200, get.body);
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
    // runMaintenance() drains at most 20 queued deletions per pass, oldest
    // first, so a full-suite run can leave this key for a later pass. Drain
    // until it is gone rather than assuming one pass suffices.
    let objects = await s3!.send(
      new ListObjectsV2Command({ Bucket: config.STORAGE_BUCKET, Prefix: key }),
    );
    for (let pass = 0; pass < 10 && objects.KeyCount; pass++) {
      await runMaintenance();
      objects = await s3!.send(
        new ListObjectsV2Command({
          Bucket: config.STORAGE_BUCKET,
          Prefix: key,
        }),
      );
    }
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

// Uploads a shared resource partway through, so it needs object storage.
test(
  "lesson directory preserves legacy drafts, class progress, independent copies and shared resources",
  { skip: !s3 },
  async () => {
    const u = await account(true);
    const call = async (
      method: any,
      url: string,
      payload?: any,
      expected = 200,
    ) => {
      const r = await app.inject({
        method,
        url,
        headers: { cookie: u.cookie },
        payload,
      });
      assert.equal(r.statusCode, expected, r.body);
      return r.json();
    };
    const subject = (
      await call(
        "POST",
        "/v1/teaching/subjects",
        { name: "Custom science", grades: [8, 10] },
        201,
      )
    ).item;
    const a = (
      await call("POST", "/v1/teaching/classes", { name: "8A", grade: 8 }, 201)
    ).item;
    const b = (
      await call("POST", "/v1/teaching/classes", { name: "8B", grade: 8 }, 201)
    ).item;
    const wa = (
      await call(
        "POST",
        "/v1/teaching/workspaces",
        { subjectId: subject.id, classId: a.id },
        201,
      )
    ).item;
    const wb = (
      await call(
        "POST",
        "/v1/teaching/workspaces",
        { subjectId: subject.id, classId: b.id },
        201,
      )
    ).item;
    const legacy = await doc(u.cookie, "lesson");
    assert.ok(
      (
        await call("GET", "/v1/documents?kind=lesson&unassigned=true")
      ).items.some((i: any) => i.id === legacy.id),
    );
    const metadata = { workspaceId: wa.id, term: 2, week: 4, status: "Taught" };
    const saved = (
      await call("PATCH", "/v1/documents/" + legacy.id, {
        revision: legacy.revision,
        title: "Fractions",
        content: {
          ...legacy.content,
          topic: "Equivalent fractions",
          reflection: "8A needs practice",
          homework: "Page 10",
        },
        plannedDate: "2026-09-21",
        lesson: metadata,
      })
    ).item;
    const opened = await call("GET", "/v1/documents/" + legacy.id);
    assert.equal(opened.item.content.body, legacy.content.body);
    assert.equal(opened.item.term, 2);
    assert.equal(opened.item.week, 4);
    assert.equal(opened.item.lesson_status, "Taught");
    assert.ok(opened.item.taught_at);
    assert.equal(opened.workspace.class, "8A");
    assert.ok(
      !(
        await call("GET", "/v1/documents?kind=lesson&unassigned=true")
      ).items.some((i: any) => i.id === legacy.id),
    );
    assert.equal(
      (
        await call(
          "GET",
          "/v1/documents?workspaceId=" +
            wa.id +
            "&search=Equivalent&term=2&status=Taught",
        )
      ).items.length,
      1,
    );
    await call(
      "PATCH",
      "/v1/documents/" + legacy.id,
      {
        revision: legacy.revision,
        title: "Stale edit",
        content: {},
        lesson: metadata,
      },
      409,
    );
    await call("PUT", "/v1/resume/" + legacy.id, {
      kind: "document",
      state: { field: "reflection", cursor: 3, scroll: 40 },
    });
    assert.equal(
      (await call("GET", "/v1/teaching/workspaces/" + wa.id)).last.id,
      legacy.id,
    );
    const video = (
      await call(
        "POST",
        "/v1/resources/video-links",
        { title: "Fraction demonstration", url: "https://example.com/video" },
        201,
      )
    ).item;
    await call(
      "POST",
      "/v1/resources/video-links",
      { title: "Unsafe", url: "javascript:alert(1)" },
      400,
    );
    await call(
      "POST",
      "/v1/resources/video-links",
      { title: "Insecure", url: "http://example.com/" },
      400,
    );
    const uploaded = await upload(
      u.cookie,
      "fractions.txt",
      Buffer.from("Shared fractions worksheet"),
    );
    assert.equal(uploaded.statusCode, 202, uploaded.body);
    const fileId = uploaded.json().item.id;
    await call(
      "PUT",
      `/v1/teaching/workspaces/${wa.id}/resources/${fileId}`,
      undefined,
      404,
    );
    await runScanJobs();
    await call("PATCH", "/v1/resources/" + fileId, {
      title: "Fractions worksheet",
      category: "Worksheets",
    });
    await call("PUT", `/v1/teaching/workspaces/${wa.id}/resources/${fileId}`);
    await call("PUT", `/v1/teaching/workspaces/${wb.id}/resources/${fileId}`);
    await call(
      "DELETE",
      `/v1/teaching/workspaces/${wa.id}/resources/${fileId}`,
    );
    assert.ok(
      (
        await call("GET", `/v1/teaching/workspaces/${wb.id}/resources`)
      ).items.some((r: any) => r.id === fileId),
    );
    const downloaded = await app.inject({
      url: "/v1/resources/" + fileId + "/download",
      headers: { cookie: u.cookie },
    });
    assert.equal(downloaded.statusCode, 200);
    assert.equal(downloaded.body, "Shared fractions worksheet");
    await call("PUT", `/v1/documents/${legacy.id}/resources/${video.id}`);
    await call("PUT", `/v1/teaching/workspaces/${wa.id}/resources/${video.id}`);
    const copy = (
      await call(
        "POST",
        "/v1/documents/" + legacy.id + "/copy",
        { kind: "lesson", title: "Fractions for 8B", workspaceId: wb.id },
        201,
      )
    ).item;
    assert.equal(copy.workspace_id, wb.id);
    assert.equal(copy.lesson_status, "Draft");
    assert.equal(copy.taught_at, null);
    assert.equal(copy.content.reflection, undefined);
    assert.equal(copy.planned_date, null);
    assert.equal(copy.content.homework, "Page 10");
    assert.equal(copy.term, 2);
    assert.equal(
      (await call("GET", "/v1/documents/" + copy.id)).resources[0].id,
      video.id,
    );
    await call("DELETE", `/v1/documents/${legacy.id}/resources/${video.id}`);
    await call(
      "DELETE",
      `/v1/teaching/workspaces/${wa.id}/resources/${video.id}`,
    );
    assert.equal(
      (await call("GET", "/v1/documents/" + copy.id)).resources[0].id,
      video.id,
    );
    assert.equal(
      (await call("GET", "/v1/resources/" + video.id)).item.status,
      "ready",
    );
    assert.deepEqual(
      (await call("GET", "/v1/teaching/workspaces/" + wa.id)).coverage,
      { total: 1, taught: 1 },
    );
    assert.deepEqual(
      (await call("GET", "/v1/teaching/workspaces/" + wb.id)).coverage,
      { total: 1, taught: 0 },
    );
    const learner = (
      await call(
        "POST",
        `/v1/teaching/classes/${a.id}/learners`,
        { name: "Learner One", identifier: "L1" },
        201,
      )
    ).item;
    await call("PATCH", "/v1/teaching/learners/" + learner.id, {
      name: "Learner Two",
      identifier: "L2",
    });
    assert.equal(
      (await call("GET", `/v1/teaching/classes/${a.id}/learners`)).items[0]
        .name,
      "Learner Two",
    );
    await call("PATCH", "/v1/teaching/classes/" + a.id, {
      name: "8A North",
      archived: true,
    });
    assert.equal(
      (await call("GET", "/v1/documents/" + legacy.id)).item.revision,
      saved.revision,
    );
    assert.equal(
      (await call("GET", "/v1/teaching/workspaces/" + wa.id)).item.class,
      "8A North",
    );
    await call(
      "POST",
      "/v1/documents",
      { kind: "lesson", title: "Blocked", content: {}, lesson: metadata },
      404,
    );
    await call("PATCH", "/v1/teaching/classes/" + a.id, { archived: false });
    await call(
      "PATCH",
      "/v1/teaching/subjects/" + subject.id,
      { grades: [10] },
      409,
    );
    await call("PATCH", "/v1/teaching/subjects/" + subject.id, {
      name: "Science renamed",
      archived: true,
    });
    assert.equal(
      (await call("GET", "/v1/teaching/workspaces/" + wa.id)).item.subject,
      "Science renamed",
    );
    await call("DELETE", "/v1/teaching/learners/" + learner.id);
    await call("DELETE", "/v1/resources/" + video.id);
    assert.equal(
      (await call("GET", "/v1/documents/" + copy.id)).resources.length,
      0,
    );
  },
);

test("every teaching relationship rejects cross-user identifiers and mismatched grades", async () => {
  const a = await account(true),
    b = await account(true);
  const call = async (
    user: typeof a,
    method: any,
    url: string,
    payload?: any,
    expected = 200,
  ) => {
    const r = await app.inject({
      method,
      url,
      headers: { cookie: user.cookie },
      payload,
    });
    assert.equal(r.statusCode, expected, method + " " + url + " " + r.body);
    return r.json();
  };
  const fixture = async (user: typeof a) => {
    const subject = (
      await call(
        user,
        "POST",
        "/v1/teaching/subjects",
        { name: "History", grades: [8] },
        201,
      )
    ).item;
    const cls = (
      await call(
        user,
        "POST",
        "/v1/teaching/classes",
        { name: "8A", grade: 8 },
        201,
      )
    ).item;
    const workspace = (
      await call(
        user,
        "POST",
        "/v1/teaching/workspaces",
        { subjectId: subject.id, classId: cls.id },
        201,
      )
    ).item;
    const lesson = await doc(user.cookie, "lesson");
    const learner = (
      await call(
        user,
        "POST",
        `/v1/teaching/classes/${cls.id}/learners`,
        { name: "Private learner" },
        201,
      )
    ).item;
    const resource = (
      await call(
        user,
        "POST",
        "/v1/resources/video-links",
        { title: "Private video", url: "https://example.com/" },
        201,
      )
    ).item;
    return { subject, cls, workspace, lesson, learner, resource };
  };
  const mine = await fixture(a),
    other = await fixture(b);
  await call(
    a,
    "POST",
    "/v1/teaching/workspaces",
    { subjectId: other.subject.id, classId: mine.cls.id },
    404,
  );
  await call(
    a,
    "POST",
    "/v1/teaching/workspaces",
    { subjectId: mine.subject.id, classId: other.cls.id },
    404,
  );
  const wrong = (
    await call(
      a,
      "POST",
      "/v1/teaching/classes",
      { name: "12A", grade: 12 },
      201,
    )
  ).item;
  await call(
    a,
    "POST",
    "/v1/teaching/workspaces",
    { subjectId: mine.subject.id, classId: wrong.id },
    404,
  );
  for (const [kind, id] of [
    ["subjects", other.subject.id],
    ["classes", other.cls.id],
  ])
    await call(
      a,
      "PATCH",
      `/v1/teaching/${kind}/${id}`,
      { name: "Stolen", archived: true },
      404,
    );
  await call(
    a,
    "GET",
    "/v1/teaching/workspaces/" + other.workspace.id,
    undefined,
    404,
  );
  await call(
    a,
    "GET",
    "/v1/documents?workspaceId=" + other.workspace.id,
    undefined,
    404,
  );
  for (const method of ["GET", "POST"])
    await call(
      a,
      method,
      `/v1/teaching/classes/${other.cls.id}/learners`,
      method === "POST" ? { name: "Intruder" } : undefined,
      404,
    );
  await call(
    a,
    "PATCH",
    "/v1/teaching/learners/" + other.learner.id,
    { name: "Intruder" },
    404,
  );
  await call(
    a,
    "DELETE",
    "/v1/teaching/learners/" + other.learner.id,
    undefined,
    404,
  );
  const metadata = {
    workspaceId: other.workspace.id,
    term: null,
    week: null,
    status: "Draft",
  };
  await call(
    a,
    "POST",
    "/v1/documents",
    { kind: "lesson", title: "Intruder", content: {}, lesson: metadata },
    404,
  );
  await call(
    a,
    "PATCH",
    "/v1/documents/" + mine.lesson.id,
    { revision: 1, title: "Intruder", content: {}, lesson: metadata },
    404,
  );
  await call(
    a,
    "POST",
    "/v1/documents/" + mine.lesson.id + "/copy",
    { kind: "lesson", title: "Intruder", workspaceId: other.workspace.id },
    404,
  );
  await call(
    a,
    "POST",
    "/v1/documents/" + other.lesson.id + "/copy",
    { kind: "lesson", title: "Intruder", workspaceId: mine.workspace.id },
    404,
  );
  await call(
    a,
    "GET",
    `/v1/teaching/workspaces/${other.workspace.id}/resources`,
    undefined,
    404,
  );
  for (const method of ["PUT", "DELETE"]) {
    for (const [w, r] of [
      [mine.workspace.id, other.resource.id],
      [other.workspace.id, mine.resource.id],
    ])
      await call(
        a,
        method,
        `/v1/teaching/workspaces/${w}/resources/${r}`,
        undefined,
        404,
      );
    for (const [d, r] of [
      [mine.lesson.id, other.resource.id],
      [other.lesson.id, mine.resource.id],
    ])
      await call(
        a,
        method,
        `/v1/documents/${d}/resources/${r}`,
        undefined,
        404,
      );
  }
  await call(
    a,
    "PATCH",
    "/v1/resources/" + other.resource.id,
    { title: "Stolen", category: "Videos" },
    404,
  );
  await call(a, "DELETE", "/v1/resources/" + other.resource.id, undefined, 404);
  await call(
    a,
    "PUT",
    "/v1/resume/" + other.lesson.id,
    { kind: "document", state: {} },
    404,
  );
  const directory = await call(a, "GET", "/v1/teaching");
  assert.ok(!directory.subjects.some((s: any) => s.id === other.subject.id));
  assert.ok(!directory.classes.some((c: any) => c.id === other.cls.id));
});
