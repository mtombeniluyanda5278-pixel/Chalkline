// Adapter endpoint deployed to Vercel (project root: /api/send-email).
// Receives the app's generic email-delivery POST and forwards it to Brevo.
//
// Required environment variables (set in Vercel project settings, NOT in the
// main app's env):
//   ADAPTER_AUTH_TOKEN  - shared secret; must match EMAIL_DELIVERY_TOKEN in
//                          the main app's config
//   BREVO_API_KEY       - your Brevo API key (kept only here, never in the
//                          main app)
//   BREVO_SENDER_EMAIL  - the single sender address you verified in Brevo
//   BREVO_SENDER_NAME   - optional display name, defaults to "Chalkline"
//
// In the main app, set:
//   EMAIL_DELIVERY_URL   = https://<this-project>.vercel.app/api/send-email
//   EMAIL_DELIVERY_TOKEN = <same value as ADAPTER_AUTH_TOKEN above>

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const expectedToken = process.env.ADAPTER_AUTH_TOKEN;
  const authHeader =
    typeof req.headers.authorization === "string"
      ? req.headers.authorization
      : "";
  if (
    !expectedToken ||
    !timingSafeEqual(authHeader, `Bearer ${expectedToken}`)
  ) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const payload =
    typeof req.body === "object" && req.body !== null ? req.body : {};
  const { to, subject, body } = payload as {
    to?: unknown;
    subject?: unknown;
    body?: unknown;
  };
  if (
    !isNonEmptyString(to) ||
    !isNonEmptyString(subject) ||
    !isNonEmptyString(body)
  ) {
    res.status(400).json({ error: "invalid payload" });
    return;
  }

  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME ?? "Chalkline";
  if (!apiKey || !senderEmail) {
    // Misconfigured adapter - do not leak details to the caller.
    console.error(
      "send-email adapter missing BREVO_API_KEY or BREVO_SENDER_EMAIL",
    );
    res.status(500).json({ error: "adapter misconfigured" });
    return;
  }

  try {
    const brevoResponse = await fetch(BREVO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: [{ email: to }],
        subject,
        textContent: body,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!brevoResponse.ok) {
      console.error("Brevo rejected send", brevoResponse.status);
      res.status(502).json({ error: "delivery failed" });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("send-email adapter request failed");
    res.status(502).json({ error: "delivery failed" });
  }
}
