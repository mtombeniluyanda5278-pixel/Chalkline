import "dotenv/config";
import { z } from "zod";
const bytes = (value: number) =>
  z.coerce.number().int().positive().default(value);
const bool = (value: boolean) =>
  z
    .enum(["true", "false"])
    .default(String(value) as "true" | "false")
    .transform((v) => v === "true");
const Env = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_NAME: z.string().default("Chix"),
  OUTBOX_ENCRYPTION_KEY: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
  OUTBOX_PREVIOUS_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  TOKEN_PASSWORD_RESET_MINUTES: bytes(15),
  TOKEN_VERIFY_EMAIL_MINUTES: bytes(1440),
  TOKEN_VERIFY_RECOVERY_MINUTES: bytes(30),
  TOKEN_CHANGE_EMAIL_MINUTES: bytes(30),
  TOKEN_ACCOUNT_DISCOVERY_MINUTES: bytes(15),
  DEVICE_CHALLENGE_MINUTES: bytes(5),
  RECOVERY_CODE_DAYS: bytes(365),
  LOGIN_FAILURE_WINDOW_SECONDS: bytes(900),
  LOGIN_CAPTCHA_AFTER: bytes(5),
  LOGIN_STRONG_THROTTLE_AFTER: bytes(10),
  LOGIN_FAILURE_IP_MAX: bytes(30),
  BOT_ADAPTIVE_AFTER: bytes(2),
  RATE_LIMIT_POLICY_JSON: z.string().transform((value, ctx) => {
    try { return JSON.parse(value); }
    catch { ctx.addIssue({code:'custom',message:'Rate-limit policy must be valid JSON.'}); return z.NEVER; }
  }).pipe(z.record(z.string(), z.strictObject({max:bytes(1),windowMs:bytes(1000)}))).optional(),
  RATE_LIMIT_KEY_SECRET: z.string().min(64).optional(),
  SESSION_DEFAULT_DAYS: z.coerce
    .number()
    .refine((v) => [1, 7, 30, 90].includes(v))
    .default(30),
  SESSION_IDLE_MAX_DAYS: z.coerce.number().int().min(1).max(14).default(14),
  BOT_PROTECTION_PROVIDER: z
    .enum(["turnstile", "hcaptcha", "mock", "disabled"])
    .default("disabled"),
  BOT_PROTECTION_SITE_KEY: z.string().optional(),
  BOT_PROTECTION_SECRET_KEY: z.string().optional(),
  BOT_REQUIRE_REGISTRATION: bool(true),
  FREE_DOCUMENT_QUOTA_BYTES: bytes(52428800),
  UNVERIFIED_FILE_STORAGE_QUOTA_BYTES: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(0),
  UNVERIFIED_DOCUMENT_QUOTA_BYTES: bytes(2097152),
  FILE_MAX_PDF_BYTES: bytes(26214400),
  FILE_MAX_OFFICE_BYTES: bytes(26214400),
  FILE_MAX_IMAGE_BYTES: bytes(15728640),
  FILE_MAX_TEXT_BYTES: bytes(5242880),
  OFFICE_MAX_ENTRIES: bytes(2000),
  OFFICE_MAX_UNCOMPRESSED_BYTES: bytes(104857600),
  OFFICE_MAX_ENTRY_BYTES: bytes(31457280),
  OFFICE_MAX_COMPRESSION_RATIO: bytes(100),
  OFFICE_MAX_EXTRACTED_TEXT_BYTES: bytes(5242880),
  MALWARE_SCANNER_MODE: z
    .enum(["clamav", "mock", "disabled"])
    .default("disabled"),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
  MALWARE_QUARANTINE_RETENTION_HOURS: bytes(24),
  MAX_UPLOADS_PER_USER: bytes(2),
  MAX_UPLOADS_GLOBAL: bytes(8),
  MAX_DOWNLOADS_PER_USER: bytes(4),
  MAX_DOWNLOADS_GLOBAL: bytes(20),
  MAX_SCANS_GLOBAL: bytes(2),
  SCANNER_TIMEOUT_MS: z.coerce.number().int().min(100).max(300000).default(60000),
  SCANNER_HEALTH_TIMEOUT_MS: z.coerce.number().int().min(100).max(10000).default(2000),
  TRASH_RETENTION_DAYS: bytes(30),
  ACCOUNT_DELETION_AUDIT_RETENTION_DAYS: bytes(30),
  ADMIN_IDLE_MAX_MINUTES: z.coerce.number().int().min(1).max(60).default(30),
  ADMIN_REQUIRE_PASSKEY: bool(false),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(64),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) =>
      !v || v === "false"
        ? false
        : v === "true"
          ? true
          : v.split(",").map((s) => s.trim()),
    ),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  WEBAUTHN_RP_NAME: z.string().default("Chix"),
  WEBAUTHN_RP_ID: z.string().min(1),
  WEBAUTHN_ORIGIN: z
    .url()
    .refine(
      (v) => new URL(v).origin === v,
      "Use an exact origin without path or trailing slash",
    ),
  ADMIN_NOTIFICATION_EMAIL: z.email().optional(),
  MIN_ACCOUNT_AGE_YEARS: z.coerce.number().int().min(13).max(21).default(13),
  STORAGE_ENDPOINT: z.url().optional(),
  STORAGE_REGION: z.string().default("us-east-1"),
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(25 * 1024 * 1024)
    .default(25 * 1024 * 1024),
  STORAGE_USER_QUOTA_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(500 * 1024 * 1024),
  EMAIL_DELIVERY_URL: z.url().optional(),
  EMAIL_DELIVERY_TOKEN: z.string().optional(),
  EMAIL_REQUIRED: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  DEVICE_TRUST_DAYS: z.coerce.number().int().min(1).max(180).default(90),
  SECURITY_RETENTION_DAYS: z.coerce.number().int().min(7).max(365).default(180),
});
export const config = Env.parse(
  Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")),
);
export const isProd = config.NODE_ENV === "production";
if (!config.OUTBOX_ENCRYPTION_KEY || !config.RATE_LIMIT_KEY_SECRET)
  throw new Error("Persistent dedicated outbox and rate-limit keys are required. Local development generates them with docker compose up -d.");
if (config.MALWARE_SCANNER_MODE === "clamav" && !config.CLAMAV_HOST)
  throw new Error("CLAMAV_HOST is required.");
if (isProd) {
  if (!config.OUTBOX_ENCRYPTION_KEY || !config.RATE_LIMIT_KEY_SECRET)
    throw new Error("Dedicated outbox and rate limit keys are required.");
  if (
    config.MALWARE_SCANNER_MODE === "mock" ||
    config.BOT_PROTECTION_PROVIDER === "mock"
  )
    throw new Error("Mock providers are forbidden in production.");
  if (
    config.BOT_REQUIRE_REGISTRATION &&
    (config.BOT_PROTECTION_PROVIDER === "disabled" ||
      !config.BOT_PROTECTION_SECRET_KEY ||
      !config.BOT_PROTECTION_SITE_KEY)
  )
    throw new Error("Registration requires a configured CAPTCHA provider.");
  if (!config.COOKIE_SECURE)
    throw new Error("COOKIE_SECURE must be true in production.");
  if (!config.WEBAUTHN_ORIGIN.startsWith("https:"))
    throw new Error("WEBAUTHN_ORIGIN must use HTTPS.");
  if (config.TRUST_PROXY === true)
    throw new Error(
      "TRUST_PROXY must list trusted proxy IPs/CIDRs in production, not true.",
    );
  if (
    config.EMAIL_REQUIRED &&
    (!config.EMAIL_DELIVERY_URL || !config.EMAIL_DELIVERY_TOKEN)
  )
    throw new Error(
      "Email delivery is required but no delivery adapter is configured.",
    );
  for (const url of [config.STORAGE_ENDPOINT, config.EMAIL_DELIVERY_URL])
    if (url && !url.startsWith("https:"))
      throw new Error(
        "Production storage and email adapter URLs must use HTTPS.",
      );
}
