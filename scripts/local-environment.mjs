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
  const database = test ? "chalkline_test" : "chalkline";
  const role = test ? "chalkline_test_app" : "chalkline_app";
  return {
    // Explicit local settings prevent dotenv from importing production credentials.
    NODE_ENV: test ? "test" : "development",
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
    WEBAUTHN_RP_ID: "127.0.0.1",
    WEBAUTHN_ORIGIN: "http://127.0.0.1:3000",
    BOT_PROTECTION_PROVIDER: test ? "mock" : "disabled",
    BOT_REQUIRE_REGISTRATION: "false",
    MALWARE_SCANNER_MODE: "disabled",
    STORAGE_ENDPOINT: "",
    STORAGE_BUCKET: "",
    STORAGE_ACCESS_KEY_ID: "",
    STORAGE_SECRET_ACCESS_KEY: "",
    EMAIL_DELIVERY_URL: "",
    EMAIL_DELIVERY_TOKEN: "",
    EMAIL_REQUIRED: "false",
  };
}
