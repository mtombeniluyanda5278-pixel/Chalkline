import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "./config.js";
import { emailAdapter } from "./mail.js";

test("Brevo uses its API contract and generic adapters receive body instead of Resend text", async () => {
  const before = {
    BREVO_API_KEY: config.BREVO_API_KEY,
    BREVO_SENDER_EMAIL: config.BREVO_SENDER_EMAIL,
    EMAIL_DELIVERY_URL: config.EMAIL_DELIVERY_URL,
    EMAIL_DELIVERY_TOKEN: config.EMAIL_DELIVERY_TOKEN,
  };
  const original = globalThis.fetch;
  const calls: Array<{ url: unknown; options: RequestInit }> = [];
  try {
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options: options! });
      return new Response("{}", { status: 201 });
    };
    Object.assign(config, {
      BREVO_API_KEY: "test-only-key",
      BREVO_SENDER_EMAIL: "sender@example.com",
    });
    const message = {
      to: "teacher@example.com",
      subject: "Verification",
      body: "Your code is: 123456",
    };
    await emailAdapter()!.send(message);
    assert.equal(calls[0]!.url, "https://api.brevo.com/v3/smtp/email");
    assert.equal(
      (calls[0]!.options.headers as Record<string, string>)["api-key"],
      "test-only-key",
    );
    assert.deepEqual(JSON.parse(calls[0]!.options.body as string), {
      sender: { email: "sender@example.com", name: config.BREVO_SENDER_NAME },
      to: [{ email: message.to }],
      subject: message.subject,
      textContent: message.body,
    });
    Object.assign(config, {
      BREVO_API_KEY: undefined,
      BREVO_SENDER_EMAIL: undefined,
      EMAIL_DELIVERY_URL: "https://adapter.example.com/send",
      EMAIL_DELIVERY_TOKEN: "adapter-test-token",
    });
    await emailAdapter()!.send(message);
    assert.deepEqual(JSON.parse(calls[1]!.options.body as string), message);
    globalThis.fetch = async () => new Response("{}", { status: 401 });
    await assert.rejects(emailAdapter()!.send(message), /401/);
  } finally {
    Object.assign(config, before);
    globalThis.fetch = original;
  }
});
