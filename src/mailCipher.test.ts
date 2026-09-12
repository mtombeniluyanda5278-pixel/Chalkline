import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { openMail, sealMail } from "./mailCipher.js";

test("outbox envelopes survive restart, support explicit old keys, and authenticate ciphertext", () => {
  const oldKey=randomBytes(32).toString('hex'), newKey=randomBytes(32).toString('hex');
  const plaintext='Test verification secret '+randomBytes(32).toString('base64url');
  const old=sealMail(plaintext,oldKey);
  assert.ok(!old.includes(plaintext));
  assert.equal(openMail(old,oldKey),plaintext);
  assert.equal(openMail(old,newKey,oldKey),plaintext);
  assert.equal(openMail(old.slice(3),newKey,oldKey),plaintext);
  const migrated=sealMail(openMail(old,newKey,oldKey),newKey);
  assert.equal(openMail(migrated,newKey),plaintext);
  assert.throws(()=>openMail(migrated,oldKey));
  const changed=Buffer.from(migrated.slice(3),'base64'); changed[changed.length-1]! ^= 1;
  assert.throws(()=>openMail('v1:'+changed.toString('base64'),newKey));
  assert.throws(()=>openMail('garbage',newKey));
});
