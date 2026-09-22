import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { requireUser, requireRecentAuth } from "./auth.js";
import { pool } from "./db.js";
import { transaction } from "./transactions.js";
import { failure, parse, limit, itemId } from "./http.js";
import { maskedEmail } from "./recovery.js";
import { config } from "./config.js";
import { deliverDevOrLogEmail, encryptMail } from "./mail.js";
import {
  AudienceFilters,
  accountMetrics,
  audienceWhere,
} from "./adminAudience.js";
import type { PoolClient } from "pg";
import { lockSessionUser, type SessionUser } from "./sessions.js";
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const user = await requireUser(req, reply);
  if (!user) return null;
  if (user.role !== "admin")
    throw failure(403, "Administrator access required.");
  if (!(await requireRecentAuth(user, reply, 5 * 60 * 1000))) return null;
  if (config.ADMIN_REQUIRE_PASSKEY && user.authMethod !== "passkey")
    throw failure(403, "Use a passkey for administrator access.");
  await limit("admin", user.id);
  return user;
}
async function lockAdmin(c: PoolClient, admin: SessionUser) {
  const user = await lockSessionUser(c, admin);
  if (user.role !== "admin")
    throw failure(403, "Administrator access required.");
  const valid = await c.query(
    "SELECT id FROM sessions WHERE id=$1 AND reauthenticated_at>now()-interval '5 minutes' AND (NOT $2::boolean OR auth_method='passkey')",
    [admin.sessionId, config.ADMIN_REQUIRE_PASSKEY],
  );
  if (!valid.rowCount)
    throw failure(401, "Administrator confirmation required.");
}
const Category = z.enum(["bug", "feature", "usability", "content", "other"]);
const Diagnostics = z.strictObject({
  appVersion: z.string().max(40),
  route: z.enum([
    "dashboard",
    "notes",
    "lessons",
    "templates",
    "files",
    "account",
    "onboarding",
    "feedback",
    "other",
  ]),
  browser: z.enum(["Chrome", "Firefox", "Safari", "Edge", "Other"]),
  os: z.enum(["Windows", "macOS", "Linux", "iOS", "Android", "Other"]),
  viewport: z.strictObject({
    width: z.number().int().min(1).max(20000),
    height: z.number().int().min(1).max(20000),
  }),
  timestamp: z.iso.datetime(),
  requestId: z.uuid().optional(),
});
export async function registerAdminRoutes(app: FastifyInstance) {
  app.post("/v1/feedback", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    await limit("feedback", user.id);
    const b = parse(
      z.strictObject({
        category: Category,
        message: z.string().trim().min(10).max(4000),
        includeDiagnostics: z.boolean().default(false),
        diagnostics: z.unknown().optional(),
      }),
      req.body,
    );
    const diagnostics =
      b.includeDiagnostics && b.diagnostics !== undefined
        ? parse(Diagnostics, b.diagnostics)
        : null;
    const item = await transaction(async (c) => {
      const row = (
        await c.query(
          "INSERT INTO feedback(user_id,category,message,diagnostics) VALUES($1,$2,$3,$4) RETURNING id,status",
          [user.id, b.category, b.message, diagnostics],
        )
      ).rows[0];
      if (config.ADMIN_NOTIFICATION_EMAIL)
        await deliverDevOrLogEmail(
          {
            to: config.ADMIN_NOTIFICATION_EMAIL,
            subject: "New Chix feedback",
            body: `Category: ${b.category}. Review securely: ${config.WEBAUTHN_ORIGIN}/#/admin`,
          },
          c,
          `feedback:${row.id}`,
        );
      return row;
    });
    return reply.code(201).send({ item });
  });
  app.get("/v1/feedback", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    return {
      items: (
        await pool.query(
          "SELECT id,category,message,status,created_at FROM feedback WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
          [user.id],
        )
      ).rows,
    };
  });
  app.get("/v1/feedback/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const row = (
      await pool.query(
        "SELECT id,category,message,status,created_at FROM feedback WHERE id=$1 AND user_id=$2",
        [itemId(req), user.id],
      )
    ).rows[0];
    if (!row) throw failure(404, "Feedback unavailable.");
    return { item: row };
  });
  app.get("/v1/admin/users", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const q = parse(
      z.object({
        offset: z.coerce.number().int().min(0).default(0),
        filters: z.string().optional(),
      }),
      req.query,
    );
    let decoded: unknown = {};
    try {
      decoded = q.filters ? JSON.parse(q.filters) : {};
    } catch {
      throw failure(400, "Invalid audience filters.");
    }
    const where = audienceWhere(parse(AudienceFilters, decoded));
    const rows = (
      await pool.query(
        `WITH accounts AS (${accountMetrics}) SELECT *,count(*) OVER()::int AS total FROM accounts ${where.sql} ORDER BY created_at DESC,id LIMIT 20 OFFSET $${where.values.length + 1}`,
        [...where.values, q.offset],
      )
    ).rows;
    return {
      total: rows[0]?.total ?? 0,
      plans: (
        await pool.query("SELECT code FROM plans ORDER BY code")
      ).rows.map((row) => row.code),
      items: rows.map(({ email, ...row }) => ({
        ...row,
        email: maskedEmail(email),
      })),
    };
  });
  app.post("/v1/admin/emails/preview", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const body = parse(
      z.strictObject({
        filters: AudienceFilters,
        kind: z.enum(["service", "announcement"]),
        subject: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .regex(/^[^\r\n]+$/),
        message: z.string().trim().min(1).max(20000),
      }),
      req.body,
    );
    return transaction(async (c) => {
      await lockAdmin(c, admin);
      const where = audienceWhere(body.filters, body.kind);
      const recipients = (
        await c.query(
          `WITH accounts AS (${accountMetrics}) SELECT id,first_name,email FROM accounts ${where.sql} ORDER BY id LIMIT 10001`,
          where.values,
        )
      ).rows;
      if (recipients.length > 10000)
        throw failure(
          413,
          "Narrow your filters to at most 10,000 recipients per email.",
        );
      if (!recipients.length)
        throw failure(400, "No eligible accounts match these filters.");
      const campaign = (
        await c.query(
          "INSERT INTO admin_email_campaigns(admin_user_id,kind,subject,encrypted_body,filters,recipient_ids) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,expires_at",
          [
            admin.id,
            body.kind,
            body.subject,
            encryptMail(body.message),
            body.filters,
            recipients.map((row) => row.id),
          ],
        )
      ).rows[0];
      return {
        ...campaign,
        count: recipients.length,
        subject: body.subject,
        message: body.message,
        sample: recipients.slice(0, 10).map((row) => ({
          first_name: row.first_name,
          email: maskedEmail(row.email),
        })),
      };
    });
  });
  app.post("/v1/admin/emails/:id/send", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    return transaction(async (c) => {
      await lockAdmin(c, admin);
      const campaign = (
        await c.query(
          "SELECT * FROM admin_email_campaigns WHERE id=$1 AND admin_user_id=$2 FOR UPDATE",
          [itemId(req), admin.id],
        )
      ).rows[0];
      if (!campaign) throw failure(404, "Email preview not found.");
      if (campaign.queued_at)
        return { queued: campaign.queued_count, alreadyQueued: true };
      if (new Date(campaign.expires_at).getTime() <= Date.now())
        throw failure(
          409,
          "This preview expired. Preview the audience again before sending.",
        );
      const queued = await c.query(
        `INSERT INTO notification_outbox(user_id,recipient,subject,encrypted_body,dedupe_key)
        SELECT id,email,$2,$3,'campaign:'||$4::text||':'||id::text FROM users
        WHERE id=ANY($1::uuid[]) AND email_verified_at IS NOT NULL AND suspended_at IS NULL AND NOT registration_pending
        AND ($5='service' OR marketing_announcements) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id`,
        [
          campaign.recipient_ids,
          campaign.subject,
          campaign.encrypted_body,
          campaign.id,
          campaign.kind,
        ],
      );
      await c.query(
        "UPDATE admin_email_campaigns SET queued_at=now(),queued_count=$2 WHERE id=$1",
        [campaign.id, queued.rowCount],
      );
      await c.query(
        "INSERT INTO admin_audit_log(admin_user_id,action,metadata) VALUES($1,'email_campaign_queued',$2)",
        [
          admin.id,
          {
            campaignId: campaign.id,
            count: queued.rowCount,
            kind: campaign.kind,
          },
        ],
      );
      return {
        queued: queued.rowCount,
        skipped: campaign.recipient_ids.length - (queued.rowCount ?? 0),
      };
    });
  });
  app.post("/v1/admin/users/:id/contact", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const b = parse(
      z.strictObject({ reason: z.string().trim().min(10).max(300) }),
      req.body,
    );
    return transaction(async (c) => {
      await lockAdmin(c, admin);
      const row = (
        await c.query("SELECT email,recovery_email FROM users WHERE id=$1", [
          itemId(req),
        ])
      ).rows[0];
      if (!row) throw failure(404, "Account unavailable.");
      await c.query(
        "INSERT INTO admin_audit_log(admin_user_id,target_user_id,action,metadata) VALUES($1,$2,'contact_reveal',$3)",
        [admin.id, itemId(req), { reason: b.reason }],
      );
      return row;
    });
  });
  app.post("/v1/admin/users/:id/suspension", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const b = parse(
      z.strictObject({
        suspended: z.boolean(),
        reason: z.string().trim().min(10).max(300),
      }),
      req.body,
    );
    if (itemId(req) === admin.id)
      throw failure(400, "Cannot suspend your own account.");
    await transaction(async (c) => {
      await c.query(
        "SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [[admin.id, itemId(req)]],
      );
      await lockAdmin(c, admin);
      if (
        !(
          await c.query(
            "UPDATE users SET pending_recovery_email=NULL,suspended_at=CASE WHEN $2 THEN now() ELSE NULL END,auth_epoch=auth_epoch+1 WHERE id=$1",
            [itemId(req), b.suspended],
          )
        ).rowCount
      )
        throw failure(404, "Account unavailable.");
      await c.query("DELETE FROM sessions WHERE user_id=$1", [itemId(req)]);
      await c.query(
        "INSERT INTO admin_audit_log(admin_user_id,target_user_id,action,metadata) VALUES($1,$2,'suspension',$3)",
        [admin.id, itemId(req), b],
      );
    });
    return { ok: true };
  });
  app.get("/v1/admin/feedback", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    return {
      items: (
        await pool.query(
          "SELECT id,category,message,status,created_at,diagnostics FROM feedback ORDER BY created_at DESC LIMIT 50",
        )
      ).rows,
    };
  });
  app.patch("/v1/admin/feedback/:id", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const b = parse(
      z.strictObject({
        status: z.enum(["NEW", "REVIEWING", "PLANNED", "RESOLVED", "CLOSED"]),
      }),
      req.body,
    );
    await transaction(async (c) => {
      await lockAdmin(c, admin);
      if (
        !(
          await c.query(
            "UPDATE feedback SET status=$2,updated_at=now() WHERE id=$1",
            [itemId(req), b.status],
          )
        ).rowCount
      )
        throw failure(404, "Feedback unavailable.");
      await c.query(
        "INSERT INTO admin_audit_log(admin_user_id,action,metadata) VALUES($1,'feedback_status',$2)",
        [admin.id, { feedbackId: itemId(req), status: b.status }],
      );
    });
    return { ok: true };
  });
  app.get("/v1/admin/jobs", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    return {
      scans: (
        await pool.query(
          "SELECT id,attempts,state,available_at,lease_until FROM jobs WHERE state<>'done' ORDER BY available_at LIMIT 50",
        )
      ).rows,
      mail: (
        await pool.query(
          "SELECT state,count(*) FROM notification_outbox GROUP BY state",
        )
      ).rows,
      deletions: (
        await pool.query(
          "SELECT state,count(*) FROM object_deletions GROUP BY state",
        )
      ).rows,
    };
  });
  app.post("/v1/admin/jobs/:id/retry", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    await transaction(async (c) => {
      await lockAdmin(c, admin);
      const row = (
        await c.query(
          "UPDATE jobs SET state='pending',attempts=0,available_at=now(),lease_until=NULL WHERE id=$1 AND state='dead' RETURNING resource_id",
          [itemId(req)],
        )
      ).rows[0];
      if (!row) throw failure(404, "Job unavailable.");
      if (
        !(
          await c.query(
            "UPDATE resources SET status='pending_scan' WHERE id=$1 AND status='scan_failed'",
            [row.resource_id],
          )
        ).rowCount
      )
        throw failure(409, "Only failed scans can be retried.");
      await c.query(
        "INSERT INTO admin_audit_log(admin_user_id,action,metadata) VALUES($1,'scan_retry',$2)",
        [admin.id, { jobId: itemId(req) }],
      );
    });
    return { ok: true };
  });
}
