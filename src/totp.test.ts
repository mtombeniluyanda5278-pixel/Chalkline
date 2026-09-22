import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authenticator,
  newAuthenticator,
  verifyAuthenticator,
  sealAuthenticator,
  openAuthenticator,
} from "./totp.js";
const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
test("TOTP matches RFC 6238 SHA-1 vectors, rejects expired/malformed/replayed codes", () => {
  // RFC vectors truncated to the interoperable six-digit configuration.
  for (const [seconds, code] of [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
  ] as const) {
    assert.equal(
      authenticator(secret).generate({ timestamp: seconds * 1000 }),
      code,
    );
    const step = verifyAuthenticator(secret, code, -1, seconds * 1000);
    assert.equal(step, Math.floor(seconds / 30));
    assert.equal(
      verifyAuthenticator(secret, code, step!, seconds * 1000),
      null,
    );
    assert.equal(
      verifyAuthenticator(secret, code, -1, (seconds + 120) * 1000),
      null,
    );
  }
  assert.equal(verifyAuthenticator(secret, "12345"), null);
  assert.equal(verifyAuthenticator(secret, "abcdef"), null);
});
test("setup produces independent keys and local QR images; ciphertext is bound to its owner", async () => {
  const a = await newAuthenticator("teacher@example.com"),
    b = await newAuthenticator("teacher@example.com");
  assert.notEqual(a.secret, b.secret);
  assert.match(a.secret, /^[A-Z2-7]{32}$/);
  assert.match(a.qr, /^data:image\/png;base64,/);
  const key = "ab".repeat(32),
    next = "cd".repeat(32);
  const encrypted = sealAuthenticator(a.secret, key, "owner");
  assert.ok(!encrypted.includes(a.secret));
  assert.equal(openAuthenticator(encrypted, key, "owner"), a.secret);
  assert.equal(openAuthenticator(encrypted, next, "owner", key), a.secret);
  assert.throws(() => openAuthenticator(encrypted, key, "other"));
});
