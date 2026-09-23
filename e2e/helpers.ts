import type { APIRequestContext } from "@playwright/test";

// The local stack delivers no email, so sign-in codes are read from the
// notification outbox. config.ts validates the environment the moment it is
// imported, so the environment is populated before any src/ module loads.
let cached: Record<string, string> | undefined;

async function env(): Promise<Record<string, string>> {
  if (cached) return cached;
  const { localEnvironment } = await import("../scripts/local-environment.mjs");
  cached = (await localEnvironment()) as Record<string, string>;
  Object.assign(process.env, cached);
  return cached;
}

async function withClient<T>(fn: (c: any) => Promise<T>): Promise<T> {
  const e = await env();
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: e.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function readCode(email: string, subject: string, pattern: RegExp) {
  await env(); // must populate the environment before src/ modules load
  const { decryptMail } = await import("../src/mail.js");
  return withClient(async (c) => {
    const row = (
      await c.query(
        `SELECT n.encrypted_body FROM notification_outbox n
           JOIN users u ON u.id = n.user_id
          WHERE u.email = $1 AND n.subject = $2
          ORDER BY n.created_at DESC LIMIT 1`,
        [email, subject],
      )
    ).rows[0];
    if (!row) throw new Error(`No "${subject}" mail queued for ${email}`);
    const match = pattern.exec(decryptMail(row.encrypted_body));
    if (!match) throw new Error(`No code found in "${subject}" mail`);
    return match[1]!;
  });
}

export const verificationCode = (email: string) =>
  readCode(email, "Chix: verify email", /code is: ([0-9]{6})/);

export const signInCode = (email: string) =>
  readCode(email, "Chix: your sign-in code", /Your Chix code is ([0-9]{6})/);

export function newAccount() {
  const id = Math.random().toString(36).slice(2, 10);
  return {
    email: `e2e-${id}@example.com`,
    username: `e2e${id}`,
    firstName: "Test",
    lastName: "Teacher",
    country: "ZA",
    dateOfBirth: "2000-01-01",
  };
}

// Registers and verifies through the real HTTP API, leaving the browser
// context holding a live session cookie.
export async function registerVerified(
  request: APIRequestContext,
  account: ReturnType<typeof newAccount>,
) {
  const registered = await request.post("/v1/auth/register", {
    data: { ...account, trustDevice: true },
  });
  if (registered.status() !== 201)
    throw new Error(
      `register failed: ${registered.status()} ${await registered.text()}`,
    );

  const verified = await request.post("/v1/auth/verify-email", {
    data: { email: account.email, code: await verificationCode(account.email) },
  });
  if (verified.status() !== 200)
    throw new Error(
      `verify failed: ${verified.status()} ${await verified.text()}`,
    );

  await withClient((c) =>
    c.query("UPDATE users SET email_verified_at = now() WHERE email = $1", [
      account.email,
    ]),
  );
  return account;
}

// Removes only the accounts a test created. Never touches other rows.
export async function deleteAccount(email: string) {
  await withClient((c) =>
    c.query("DELETE FROM users WHERE email = $1", [email]),
  );
}
