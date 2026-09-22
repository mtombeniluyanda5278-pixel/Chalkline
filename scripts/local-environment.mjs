import { parse } from "dotenv";
import { readFile } from "node:fs/promises";
export async function localEnvironment(test = false) {
  let secrets;
  try {
    secrets = JSON.parse(
      await readFile(
        new URL("../.local/credentials.json", import.meta.url),
        "utf8",
      ),
    );
  } catch {
    throw new Error(
      "Run docker compose up -d first. Local credentials are generated automatically.",
    );
  }
  // Only mail and Google sign-in credentials are imported; local database/storage isolation remains explicit.
  const mail = {};
  if (!test) {
    for (const path of [
      "../.env",
      "../.local/email.env",
      "../.local/google.env",
    ]) {
      try {
        const values = parse(
          await readFile(new URL(path, import.meta.url), "utf8"),
        );
        for (const key of [
          "GOOGLE_CLIENT_ID",
          "GOOGLE_CLIENT_SECRET",
          "BREVO_API_KEY",
          "BREVO_SENDER_EMAIL",
          "BREVO_SENDER_NAME",
          "OPENAI_API_KEY",
          "TIMETABLE_VISION_MODEL",
        ])
          if (values[key]) mail[key] = values[key];
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  const database = test ? "chalkline_test" : "chalkline";
  const role = test ? "chalkline_test_app" : "chalkline_app";
  return {
    // Explicit local settings prevent dotenv from importing production credentials.
    NODE_ENV: test ? "test" : "development",
    OPENAI_API_KEY: test
      ? ""
      : process.env.OPENAI_API_KEY || mail.OPENAI_API_KEY || "",
    TIMETABLE_VISION_MODEL:
      process.env.TIMETABLE_VISION_MODEL ||
      mail.TIMETABLE_VISION_MODEL ||
      "gpt-4o",
    DOTENV_CONFIG_PATH: ".local/no-dotenv",
    DATABASE_URL: `postgresql://${role}:${test ? secrets.test : secrets.app}@127.0.0.1:55434/${database}`,
    LOCAL_OWNER_URL: `postgresql://chix_local_owner:${secrets.owner}@127.0.0.1:55434/${database}`,
    REDIS_URL: `redis://:${secrets.redis}@127.0.0.1:56380/${test ? 15 : 0}`,
    SESSION_SECRET: secrets.session,
    OUTBOX_ENCRYPTION_KEY: secrets.outbox,
    RATE_LIMIT_KEY_SECRET: secrets.rate,
    PORT: "3000",
    COOKIE_SECURE: "false",
    TRUST_PROXY: "false",
    // WebAuthn requires a domain RP ID; loopback IP addresses are invalid.
    WEBAUTHN_RP_ID: "localhost",
    WEBAUTHN_ORIGIN: "http://localhost:3000",
    BOT_PROTECTION_PROVIDER: test ? "mock" : "disabled",
    BOT_REQUIRE_REGISTRATION: "false",
    MALWARE_SCANNER_MODE: "disabled",
    STORAGE_ENDPOINT: "",
    STORAGE_BUCKET: "",
    STORAGE_ACCESS_KEY_ID: "",
    STORAGE_SECRET_ACCESS_KEY: "",
    BREVO_API_KEY: test
      ? ""
      : process.env.BREVO_API_KEY || mail.BREVO_API_KEY || "",
    BREVO_SENDER_EMAIL: test
      ? ""
      : process.env.BREVO_SENDER_EMAIL || mail.BREVO_SENDER_EMAIL || "",
    BREVO_SENDER_NAME: test
      ? ""
      : process.env.BREVO_SENDER_NAME || mail.BREVO_SENDER_NAME || "Chix",
    GOOGLE_CLIENT_ID: test
      ? ""
      : process.env.GOOGLE_CLIENT_ID || mail.GOOGLE_CLIENT_ID || "",
    GOOGLE_CLIENT_SECRET: test
      ? ""
      : process.env.GOOGLE_CLIENT_SECRET || mail.GOOGLE_CLIENT_SECRET || "",
    EMAIL_DELIVERY_URL: "",
    EMAIL_DELIVERY_TOKEN: "",
    EMAIL_REQUIRED: "false",
  };
}
