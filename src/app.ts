import { pool } from "./db.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import { config } from "./config.js";
import { registerAuthRoutes } from "./auth.js";
import { registerWebAuthnRoutes } from "./webauthn.js";
import { clientIp, consumeRateLimit, redis } from "./rateLimit.js";

export async function buildApp() {

const app = Fastify({
  trustProxy: config.TRUST_PROXY,
  bodyLimit: 1_048_576,
  requestTimeout: 30_000,
  logger: {
    level: config.NODE_ENV === "development" ? "info" : "warn",
    redact: ["req.headers.cookie", "req.headers.authorization"],
  },
});

app.server.keepAliveTimeout = 65_000;
app.server.headersTimeout = 60_000;

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: config.NODE_ENV === "production",
  });

    app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health" || req.url === "/ready") {
      return;
    }

    try {
      const result = await consumeRateLimit("global", clientIp(req));

      if (!result.allowed) {
        reply.header("Retry-After", String(result.retryAfterSec));
        return reply.code(429).send({ error: "Too many requests. Try again later." });
      }
    } catch (err) {
      if (
        err instanceof Error &&
        err.name === "RateLimiterUnavailableError"
      ) {
        return reply.code(503).send({
          error: "Service temporarily unavailable.",
        });
      }

      throw err;
    }
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    req.log.error(err);
    const statusCode =
      typeof err === "object" && err && "statusCode" in err && typeof err.statusCode === "number"
        ? err.statusCode
        : 500;
    const status = statusCode >= 400 && statusCode < 600 ? statusCode : 500;
    const clientMessage =
  status >= 400 && status < 500 && err instanceof Error
    ? err.message
    : "Request failed.";

const message =
  status >= 500 ? "Something went wrong." : clientMessage;
    void reply.code(status).send({ error: message });
  });

  app.get("/health", async () => ({ ok: true }));

app.get("/ready", async (req, reply) => {
  try {
    await pool.query("SELECT 1");
    await redis.ping();

    return { ok: true };
  } catch (err) {
    req.log.error(err);

    return reply.code(503).send({
      ok: false,
      error: "Service not ready.",
    });
  }
});  

  await registerAuthRoutes(app);
  await registerWebAuthnRoutes(app);
  return app;
}
