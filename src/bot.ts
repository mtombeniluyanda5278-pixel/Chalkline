import { config } from "./config.js";
import { failure } from "./http.js";
import { redis, opaqueIdentity, buckets } from "./rateLimit.js";
import { limit } from "./http.js";
export async function verifyBot(token: string | undefined, action: string) {
  if (config.BOT_PROTECTION_PROVIDER === "disabled")
    throw failure(503, "Human verification is temporarily unavailable.");
  if (!token)
    throw Object.assign(
      failure(403, "Complete human verification to continue."),
      { code: "CAPTCHA_REQUIRED" },
    );
  if (config.BOT_PROTECTION_PROVIDER === "mock") {
    if (token !== "mock-human")
      throw failure(403, "Human verification failed.");
    return;
  }
  try {
    const endpoint =
      config.BOT_PROTECTION_PROVIDER === "turnstile"
        ? "https://challenges.cloudflare.com/turnstile/v0/siteverify"
        : "https://api.hcaptcha.com/siteverify";
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      body: new URLSearchParams({
        secret: config.BOT_PROTECTION_SECRET_KEY!,
        response: token,
        sitekey: config.BOT_PROTECTION_SITE_KEY!,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const result = (await response.json()) as {
      success: boolean;
      hostname: string;
      action?: string;
    };
    if (
      !response.ok ||
      !result.success ||
      result.hostname !== new URL(config.WEBAUTHN_ORIGIN).hostname ||
      (config.BOT_PROTECTION_PROVIDER === "turnstile" &&
        result.action !== action)
    )
      throw new Error("verification");
  } catch {
    throw failure(403, "Human verification failed. Please retry.");
  }
}
export async function failedLogin(email: string, ip: string) {
  for (const identity of [email, `ip:${ip}`, `${email}:${ip}`])
    await redis.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
      1,
      `fail:${opaqueIdentity(identity)}`,
      config.LOGIN_FAILURE_WINDOW_SECONDS,
    );
}
export async function loginProtection(
  email: string,
  ip: string,
  token?: string,
) {
  const keys = [email, `ip:${ip}`, `${email}:${ip}`].map(
    (x) => `fail:${opaqueIdentity(x)}`,
  );
  const counts = (await redis.mget(...keys)).map(Number);
  // An account-wide risk signal requires proof; only the attacking IP/pair is
  // throttled, so a stranger cannot lock every browser out of another account.
  if (counts[1]! >= config.LOGIN_FAILURE_IP_MAX || counts[2]! >= config.LOGIN_STRONG_THROTTLE_AFTER) {
    const ttl = await redis.ttl(keys[counts[1]! >= config.LOGIN_FAILURE_IP_MAX ? 1 : 2]!);
    throw Object.assign(failure(429, "Too many attempts. Try again later."), {
      retryAfter: Math.max(1, ttl),
    });
  }
  if (counts[0]! >= config.LOGIN_CAPTCHA_AFTER) await verifyBot(token, "login");
}

const recoveryPolicy = {
  password_reset: ["passwordReset", "passwordResetIp"],
  account_discovery: ["accountDiscovery", "accountDiscoveryIp"],
  verification_resend: ["resendVerification", "resendVerificationIp"],
  device_recovery: ["deviceRecovery", "deviceRecoveryIp"],
} as const;

// Count abuse before looking up an account. Missing and existing identities
// therefore receive exactly the same CAPTCHA and throttling decisions.
export async function recoveryProtection(
  action: keyof typeof recoveryPolicy,
  identity: string,
  ip: string,
  token?: string,
) {
  const [accountBucket, ipBucket] = recoveryPolicy[action];
  await limit(ipBucket, ip);
  const counts = await redis.eval(
    `local maximum=0
     for _,key in ipairs(KEYS) do
       local n=redis.call('INCR',key)
       if n==1 then redis.call('PEXPIRE',key,ARGV[1]) end
       if n>maximum then maximum=n end
     end
     return maximum`,
    2,
    `risk:${action}:${opaqueIdentity(identity)}`,
    `risk:${action}:${opaqueIdentity(`ip:${ip}`)}`,
    buckets[accountBucket].windowMs,
  );
  if (Number(counts) > config.BOT_ADAPTIVE_AFTER)
    await verifyBot(token, action);
  // A missing CAPTCHA does not spend the last account delivery allowance;
  // the caller can solve the challenge and retry, under the IP ceiling.
  await limit(accountBucket, identity);
}
