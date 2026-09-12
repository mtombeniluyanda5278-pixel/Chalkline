import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyBytes(key: string): Buffer {
  if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new Error("Invalid outbox encryption key configuration.");
  return Buffer.from(key, "hex");
}

export function sealMail(plaintext: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return "v1:" + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

// The unversioned format is the existing IV + tag + ciphertext envelope.
// Old keys are explicit, temporary configuration, never inferred from session secrets.
export function openMail(envelope: string, key: string, previousKey?: string): string {
  const encoded = envelope.startsWith("v1:") ? envelope.slice(3) : envelope;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("Invalid encrypted mail.");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 28) throw new Error("Invalid encrypted mail.");
  for (const candidate of [key, previousKey]) {
    if (!candidate) continue;
    try {
      const cipher = createDecipheriv("aes-256-gcm", keyBytes(candidate), bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8");
    } catch { /* Never include the envelope or a key in errors. */ }
  }
  throw new Error("Encrypted mail could not be opened with the configured keys.");
}
