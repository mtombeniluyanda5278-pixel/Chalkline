import { createHmac } from "node:crypto";
import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";
import { sealMail, openMail } from "./mailCipher.js";

export function authenticator(secret: string, email = "") {
  return new TOTP({
    issuer: "Chix",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
}
export async function newAuthenticator(email: string) {
  const secret = new Secret({ size: 20 }).base32;
  const uri = authenticator(secret, email).toString();
  return {
    secret,
    qr: await QRCode.toDataURL(uri, {
      width: 256,
      margin: 4,
      errorCorrectionLevel: "M",
    }),
  };
}
// Return the accepted time step so callers can reject reuse transactionally.
export function verifyAuthenticator(
  secret: string,
  code: string,
  lastStep = -1,
  now = Date.now(),
) {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = authenticator(secret).validate({
    token: code,
    timestamp: now,
    window: 1,
  });
  if (delta === null) return null;
  const step = Math.floor(now / 30000) + delta;
  return step > lastStep ? step : null;
}
// Domain-separated per-account encryption prevents ciphertext swapping between users.
const keyFor = (key: string, userId: string) =>
  createHmac("sha256", Buffer.from(key, "hex"))
    .update(`chix:authenticator:v1:${userId}`)
    .digest("hex");
export const sealAuthenticator = (
  secret: string,
  key: string,
  userId: string,
) => sealMail(secret, keyFor(key, userId));
export const openAuthenticator = (
  value: string,
  key: string,
  userId: string,
  previous?: string,
) =>
  openMail(
    value,
    keyFor(key, userId),
    previous ? keyFor(previous, userId) : undefined,
  );
