import { registerFrontend } from "./frontend.js";
import { registerPreferenceRoutes } from "./preferences.js";
import { registerAdminRoutes } from "./admin.js";
import { registerRecoveryRoutes } from "./recovery.js";
import { registerDocumentRoutes } from "./documents.js";
import { registerResourceRoutes } from "./resources.js";
import { registerDeviceRoutes } from "./devices.js";
import { z } from "zod";
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
    reply.header("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.origin;
      if (
        (origin && origin !== config.WEBAUTHN_ORIGIN) ||
        req.headers["sec-fetch-site"] === "cross-site"
      ) {
        return reply
          .code(403)
          .send({ error: "Cross-origin request rejected." });
      }
    }
    if (req.url === "/health" || req.url === "/ready") {
      return;
    }

    try {
      const result = await consumeRateLimit("global", clientIp(req));

      if (!result.allowed) {
        reply.header("Retry-After", String(result.retryAfterSec));
        return reply
          .code(429)
          .send({ error: "Too many requests. Try again later." });
      }
    } catch (err) {
      if (err instanceof Error && err.name === "RateLimiterUnavailableError") {
        return reply.code(503).send({
          error: "Service temporarily unavailable.",
        });
      }

      throw err;
    }
  });

  app.addHook("preValidation", async (req, reply) => {
    for (const [key, value] of Object.entries(
      (req.params ?? {}) as Record<string, unknown>,
    )) {
      if (
        (key === "id" || key === "resourceId") &&
        !z.uuid().safeParse(value).success
      )
        return reply.code(400).send({ error: "Invalid identifier." });
    }
  });
  app.setErrorHandler((err: unknown, req, reply) => {
    if (err && typeof err === "object" && "code" in err && err.code === "P0001")
      return reply.code(413).send({
        error:
          "Document quota reached. Purge unused documents or reduce content.",
      });
    const statusCode =
      typeof err === "object" &&
      err &&
      "statusCode" in err &&
      typeof err.statusCode === "number"
        ? err.statusCode
        : 500;
    if (err && typeof err === "object" && "retryAfter" in err)
      reply.header("Retry-After", String(err.retryAfter));
    const status = statusCode >= 400 && statusCode < 600 ? statusCode : 500;
    if (status >= 500)
      req.log.error(
        { requestId: req.id },
        "Request failed; sensitive details omitted",
      );
    const clientMessage =
      status >= 400 && status < 500 && err instanceof Error
        ? err.message
        : "Request failed.";

    const message = status >= 500 ? "Something went wrong." : clientMessage;
    void reply.code(status).send({
      error: message,
      ...(err &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "CAPTCHA_REQUIRED"
        ? { code: err.code }
        : {}),
    });
  });

  app.get("/health", async () => ({ ok: true }));

  app.get("/ready", async (req, reply) => {
    try {
      await pool.query("SELECT 1");
      await redis.ping();

      return {
        ok: true,
        uploadsEnabled: config.MALWARE_SCANNER_MODE !== "disabled",
      };
    } catch (err) {
      req.log.error("Readiness dependency check failed");

      return reply.code(503).send({
        ok: false,
        error: "Service not ready.",
      });
    }
  });

  await registerAuthRoutes(app);
  await registerRecoveryRoutes(app);
  await registerPreferenceRoutes(app);
  await registerAdminRoutes(app);
  await registerWebAuthnRoutes(app);
  await registerDocumentRoutes(app);
  await registerResourceRoutes(app);
  await registerDeviceRoutes(app);
  await registerFrontend(app);
  return app;
}
