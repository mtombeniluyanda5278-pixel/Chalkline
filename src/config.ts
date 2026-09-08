import "dotenv/config";
import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1),

  REDIS_URL: z.string().min(1),

TRUST_PROXY: z
  .string()
  .optional()
  .transform((v) => v === "true"),
  
  SESSION_SECRET: z.string().min(64),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
WEBAUTHN_RP_NAME: z.string().default("Chalkline"),

WEBAUTHN_RP_ID: z.string().min(1),

WEBAUTHN_ORIGIN: z.string().url(),

BREVO_API_KEY: z.string().optional(),

ADMIN_NOTIFICATION_EMAIL: z.string().email().optional(),

BREVO_FROM_EMAIL: z.string().email().optional(),

BREVO_FROM_NAME: z.string().min(1).max(100).default("Chalkline"),

MIN_ACCOUNT_AGE_YEARS: z.coerce.number().int().min(13).max(21).default(13),
});

export const config = Env.parse(process.env);

export const isProd = config.NODE_ENV === "production";

if (isProd && !config.COOKIE_SECURE) {
  throw new Error("COOKIE_SECURE must be true in production (HTTPS cookies).");
}

if (isProd && config.WEBAUTHN_ORIGIN.startsWith("http:")) {
  throw new Error("WEBAUTHN_ORIGIN must be https in production.");
}