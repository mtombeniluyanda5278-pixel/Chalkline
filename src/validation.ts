import { z } from "zod";
import { config } from "./config.js";

const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "support",
  "security",
  "chalkline",
  "chix",
  "root",
  "help",
  "api",
  "null",
  "undefined",
]);

function yearsAgo(date: Date, timezone: string): number {
  const now = new Date(new Date().toLocaleDateString("en-CA",{timeZone:timezone})+"T00:00:00Z");
  let age = now.getUTCFullYear() - date.getUTCFullYear();
  const m = now.getUTCMonth() - date.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < date.getUTCDate())) age -= 1;
  return age;
}

export const AddressInput = z.strictObject({
  line1: z.string().trim().min(1).max(120),
  line2: z.string().trim().max(120).optional(),
  city: z.string().trim().min(1).max(80),
  region: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().min(1).max(20),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Use an ISO 3166-1 alpha-2 country code"),
});

export const RegisterInput = z
  .strictObject({
    firstName: z.string().trim().min(1).max(50),
    lastName: z.string().trim().min(1).max(50),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    email: z.string().trim().email().max(254).toLowerCase(),
    password: z.string().min(12).max(72),
    confirmPassword: z.string(),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9._]{3,20}$/),
    phone: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/, "Use E.164, e.g. +27111234567").optional(),
    address: AddressInput.optional(),
    timezone: z.string().max(100).default("Africa/Johannesburg").refine(v=>{try {new Intl.DateTimeFormat("en",{timeZone:v});return true;}catch{return false;}}),
    captchaToken: z.string().max(4096).optional(),
    trustDevice: z.boolean().default(false),
    marketingAnnouncements: z.boolean().default(false),
    marketingApps: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "Passwords do not match",
      });
    }
    if (RESERVED_USERNAMES.has(data.username)) {
      ctx.addIssue({
        code: "custom",
        path: ["username"],
        message: "Username is reserved",
      });
    }
    const dob = new Date(`${data.dateOfBirth}T00:00:00Z`);
    if (
      Number.isNaN(dob.getTime()) ||
      dob.toISOString().slice(0, 10) !== data.dateOfBirth ||
      yearsAgo(dob,data.timezone) < config.MIN_ACCOUNT_AGE_YEARS
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["dateOfBirth"],
        message: `You must be at least ${config.MIN_ACCOUNT_AGE_YEARS}`,
      });
    }
  });

export const LoginInput = z.strictObject({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(1).max(72),
  captchaToken: z.string().max(4096).optional(),
  trustDevice: z.boolean().default(false),
});

export const VerifyEmailInput = z.strictObject({
  token: z.string().min(20).max(200),
});

export const AccountDeleteInput = z.strictObject({
  password: z.string().min(1).max(72),
});

export const PasswordChangeInput = z
  .strictObject({
    currentPassword: z.string().min(1).max(72),
    newPassword: z.string().min(12).max(72),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export const PasswordResetRequestInput = z.strictObject({
  captchaToken: z.string().max(4096).optional(),
  email: z.string().trim().email().toLowerCase(),
});

export const PasswordResetConfirmInput = z
  .strictObject({
    token: z.string().min(20).max(200),
    password: z.string().min(12).max(72),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export const ProfileUpdateInput = z.strictObject({
  firstName: z.string().trim().min(1).max(50).optional(),
  lastName: z.string().trim().min(1).max(50).optional(),
  address: AddressInput.optional(),
});

export const EmailChangeInput = z.strictObject({
  email: z.string().trim().email().max(254).toLowerCase(),
  currentPassword: z.string().min(1).max(72),
});

export const UsernameChangeInput = z
  .strictObject({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9._]{3,20}$/),
    currentPassword: z.string().min(1).max(72),
  })
  .superRefine((data, ctx) => {
    if (RESERVED_USERNAMES.has(data.username)) {
      ctx.addIssue({
        code: "custom",
        path: ["username"],
        message: "Username is reserved",
      });
    }
  });

export const PhoneChangeInput = z.strictObject({
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, "Use E.164, e.g. +27111234567"),
  currentPassword: z.string().min(1).max(72),
});
