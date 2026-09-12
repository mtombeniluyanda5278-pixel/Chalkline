import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { config } from "./config.js";
import type { PoolClient } from "pg";
import { pool } from "./db.js";
export type Email = {
  to: string;
  subject: string;
  body: string;
  userId?: string;
};
export interface EmailAdapter {
  send(message: Email): Promise<void>;
}
// Development keys are process-local; production requires a persistent independent key.
const key = config.OUTBOX_ENCRYPTION_KEY ? Buffer.from(config.OUTBOX_ENCRYPTION_KEY,"hex") : randomBytes(32);
export function encryptMail(body: string) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([c.update(body, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), encrypted]).toString("base64");
}
export function decryptMail(body: string) {
  const b = Buffer.from(body, "base64"),
    c = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  c.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([c.update(b.subarray(28)), c.final()]).toString("utf8");
}
export function emailAdapter(): EmailAdapter | null {
  if (config.EMAIL_DELIVERY_URL && config.EMAIL_DELIVERY_TOKEN)
    return {
      async send(m) {
        const response = await fetch(config.EMAIL_DELIVERY_URL!, {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.EMAIL_DELIVERY_TOKEN}`,
          },
          body: JSON.stringify({ to: m.to, subject: m.subject, body: m.body }),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok)
          throw new Error("Email delivery adapter rejected the request.");
      },
    };
  if (config.NODE_ENV !== "production")
    return {
      async send(m) {
        await mkdir("mail", { recursive: true });
        await appendFile(
          "mail/dev-outbox.txt",
          `\n---\nTo: ${m.to}\n${m.subject}\n${m.body}\n`,
          { encoding: "utf8", mode: 0o600 },
        );
      },
    };
  return null;
}
// Auth only queues encrypted messages; no provider implementation is embedded in routes.
export async function deliverDevOrLogEmail(m: Email, client: PoolClient | typeof pool = pool, dedupeKey?: string): Promise<void> {
  await client.query(
    "INSERT INTO notification_outbox(user_id,recipient,subject,encrypted_body,dedupe_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(dedupe_key) DO NOTHING",
    [m.userId ?? null, m.to, m.subject, encryptMail(m.body), dedupeKey ?? null],
  );
}
export function authLink(
  kind: "verify-email" | "reset-password",
  token: string,
) {
  return `${config.WEBAUTHN_ORIGIN}/#/${kind}?token=${encodeURIComponent(token)}`;
}
export async function sendAdminAccountCreatedNotification(input: { userId: string; createdAt: Date }, client: PoolClient | typeof pool = pool) {
  await client.query("INSERT INTO notification_outbox(recipient,subject,encrypted_body,dedupe_key) VALUES($1,$2,$3,$4) ON CONFLICT(dedupe_key) DO NOTHING", [config.ADMIN_NOTIFICATION_EMAIL ?? null, "New Chix account", encryptMail(`Account created at ${input.createdAt.toISOString()}. Review: ${config.WEBAUTHN_ORIGIN}/#/admin`), `account-created:${input.userId}`]);
}
