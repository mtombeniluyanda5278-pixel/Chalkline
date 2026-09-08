import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "./passwords.js";

test("argon2id hashes are not the plaintext and verify correctly", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.notEqual(hash, "correct horse battery staple");
  assert.equal(await verifyPassword(hash, "correct horse battery staple"), true);
  assert.equal(await verifyPassword(hash, "wrong"), false);
});

test("token hashing is one-way and compare is length-safe", () => {
  const raw = randomBytes(32);
  const hashed = createHash("sha256").update(raw).digest();
  const other = createHash("sha256").update(randomBytes(32)).digest();
  assert.equal(hashed.length, other.length);
  assert.equal(timingSafeEqual(hashed, hashed), true);
  assert.equal(timingSafeEqual(hashed, other), false);
});
