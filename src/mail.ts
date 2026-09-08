import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

/**
 * Application code cannot send email. That is infrastructure (SMTP/API + DNS).
 * In development we write to mail/dev-outbox.txt so you can test flows without a provider.
 * In production this function refuses to leak tokens into HTTP responses.
 */
export async function deliverDevOrLogEmail(input: {
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
if (config.NODE_ENV === "production") {
  if (!config.BREVO_API_KEY || !config.BREVO_FROM_EMAIL) {
    throw new Error("Brevo email provider is not configured.");
  }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": config.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: {
        email: config.BREVO_FROM_EMAIL,
        name: config.BREVO_FROM_NAME,
      },
      to: [{ email: input.to }],
      subject: input.subject,
      textContent: input.body,
    }),
  });

  if (!response.ok) {
    throw new Error(`Brevo email delivery failed with status ${response.status}.`);
  }

  return;
}
  await mkdir("mail", { recursive: true });
  const line = `\n---\n${new Date().toISOString()}\nto: ${input.to}\nsubject: ${input.subject}\n${input.body}\n`;
  await appendFile(path.join("mail", "dev-outbox.txt"), line, "utf8");
}
export async function sendAdminAccountCreatedNotification(input: {
  username: string;
  email: string;
  createdAt: Date;
}): Promise<void> {
  if (!config.ADMIN_NOTIFICATION_EMAIL) {
    return;
  }

  await deliverDevOrLogEmail({
    to: config.ADMIN_NOTIFICATION_EMAIL,
    subject: "New Chalkline account created",
    body: [
      "A new Chalkline account was created.",
      "",
      `Username: ${input.username}`,
      `Email: ${input.email}`,
      `Created at: ${input.createdAt.toISOString()}`,
    ].join("\n"),
  });
}