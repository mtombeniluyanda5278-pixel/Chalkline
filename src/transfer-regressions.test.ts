import { test, before, after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import { buildApp } from "./app.js";
import { pool } from "./db.js";
import { createSession } from "./sessions.js";
import { objectStore } from "./storage.js";
import { config } from "./config.js";
// These drive real uploads/downloads through the resource routes, which need
// object storage configured; docker-compose.yml ships no storage service.
const noStorage = !config.STORAGE_ENDPOINT;
import {
  connectRedis,
  closeRedis,
  redis,
  clearTestRateLimits,
} from "./rateLimit.js";
const app = await buildApp(),
  ids: string[] = [];
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
async function account() {
  const id = randomUUID();
  const user = (
    await pool.query(
      "INSERT INTO users(email,username,first_name,last_name,date_of_birth,email_verified_at) VALUES($1,$2,'Transfer','Test','2000-01-01',now()) RETURNING id",
      [`${id}@example.com`, id.replaceAll("-", "").slice(0, 12)],
    )
  ).rows[0];
  ids.push(user.id);
  const s = await createSession(user.id, { authMethod: "email_otp" });
  return { id: user.id, cookie: `chalkline_session=${s.token}` };
}
function fastRenew() {
  const original = globalThis.setInterval;
  mock.method(globalThis, "setInterval", ((
    fn: any,
    ms: number,
    ...args: any[]
  ) => original(fn, ms === 30000 ? 10 : ms, ...args)) as typeof setInterval);
}
const until = async (fn: () => Promise<boolean>) => {
  for (let n = 0; n < 200; n++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("Transfer did not settle");
};
const prefix =
  '--transfer-test\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\nContent-Type: text/plain\r\n\r\n';
function upload(
  cookie: string,
  payload: Buffer | Readable = Buffer.from(
    prefix + "hello\r\n--transfer-test--\r\n",
  ),
) {
  return app.inject({
    method: "POST",
    url: "/v1/resources",
    headers: {
      cookie,
      "content-type": "multipart/form-data; boundary=transfer-test",
      "x-file-size": "100",
    },
    payload,
  });
}
async function reconciled(id: string) {
  assert.equal(
    (await pool.query("SELECT 1 FROM resources WHERE user_id=$1", [id]))
      .rowCount,
    0,
  );
  const usage = (
    await pool.query(
      "SELECT storage_reserved_bytes,storage_used_bytes FROM user_usage WHERE user_id=$1",
      [id],
    )
  ).rows[0];
  assert.equal(Number(usage.storage_reserved_bytes), 0);
  assert.equal(Number(usage.storage_used_bytes), 0);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM object_deletions WHERE object_key LIKE $1",
        [`users/${id}/%`],
      )
    ).rowCount,
    1,
  );
}
for (const phase of ["reception", "put"])
  test(
    `lease loss during ${phase} stops work and rolls back reservation`,
    { timeout: 10000, skip: noStorage },
    async () => {
      fastRenew();
      const a = await account();
      const store = objectStore();
      let input: Readable | undefined, signal: AbortSignal | undefined;
      const put = mock.method(
        store,
        "put",
        async (
          _key: string,
          body: Buffer | Readable,
          _size?: number,
          cancellation?: AbortSignal,
        ) => {
          assert.ok(cancellation);
          signal = cancellation;
          input = body as Readable;
          await redis.del("active:upload:global");
          await new Promise<void>((_, reject) => {
            cancellation.addEventListener(
              "abort",
              () => reject(cancellation.reason),
              { once: true },
            );
          });
        },
      );
      const payload = new PassThrough();
      payload.on("error", () => {});
      const running = Promise.resolve(
        upload(a.cookie, phase === "reception" ? payload : undefined),
      ).then(
        (r) => r.statusCode,
        () => 500,
      );
      if (phase === "reception") {
        payload.write(prefix + "partial");
        await until(async () =>
          Boolean(
            (
              await pool.query(
                "SELECT 1 FROM resources WHERE user_id=$1 AND status='uploading'",
                [a.id],
              )
            ).rowCount,
          ),
        );
        await redis.del("active:upload:global");
      }
      const status = await running;
      assert.notEqual(status, 202);
      if (phase === "put") {
        assert.ok(signal?.aborted);
        assert.ok(input?.destroyed);
      } else assert.equal(put.mock.callCount(), 0);
      payload.destroy();
      // A disconnected client settles before the handler's rollback transaction.
      // Require cleanup to complete within the bounded wait before inspecting it.
      await until(
        async () =>
          !(
            await pool.query("SELECT 1 FROM resources WHERE user_id=$1", [a.id])
          ).rowCount,
      );
      await reconciled(a.id);
      put.mock.restore();
      mock.method(
        store,
        "put",
        async (_key: string, body: Buffer | Readable) => {
          for await (const _ of body as Readable) {
          }
        },
      );
      assert.equal((await upload(a.cookie)).statusCode, 202);
    },
  );
test(
  "lease loss aborts a downloading storage stream and releases capacity",
  { timeout: 10000, skip: noStorage },
  async () => {
    fastRenew();
    const a = await account(),
      id = randomUUID();
    await pool.query(
      "INSERT INTO resources(id,user_id,object_key,original_name,title,mime,size_bytes,status,scanned_at) VALUES($1,$2,$3,'test.txt','test','text/plain',5,'ready',now())",
      [id, a.id, `users/${a.id}/${id}`],
    );
    const body = new PassThrough();
    body.on("error", () => {});
    let signal: AbortSignal | undefined;
    mock.method(
      objectStore(),
      "stream",
      async (_key: string, cancellation?: AbortSignal) => {
        signal = cancellation;
        return body;
      },
    );
    const running = Promise.resolve(
      app.inject({
        url: `/v1/resources/${id}/download`,
        headers: { cookie: a.cookie },
      }),
    ).catch(() => null);
    await until(async () => Boolean(signal));
    body.write("first");
    await redis.del("active:download:global");
    await until(async () => body.destroyed);
    assert.ok(signal?.aborted);
    await running;
    await until(
      async () => (await redis.zcard("active:download:global")) === 0,
    );
  },
);
