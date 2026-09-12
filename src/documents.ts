import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "./db.js";
import { transaction } from "./transactions.js";
import { requireUser } from "./auth.js";
import { failure, parse, itemId, limit } from "./http.js";
export const lessonFields = [
  "subject",
  "grade",
  "topic",
  "date",
  "duration",
  "objectives",
  "priorKnowledge",
  "resources",
  "introduction",
  "teachingActivities",
  "learnerActivities",
  "assessment",
  "differentiation",
  "homework",
  "reflection",
  "notes",
] as const;
const optionalText = z.string().max(20000).optional();
export const Content = z.strictObject({
  body: z.string().max(300000).optional(),
  ...Object.fromEntries(lessonFields.map((k) => [k, optionalText])),
});
const Kind = z.enum(["note", "lesson", "template"]);
const DocumentInput = z.strictObject({
  title: z.string().trim().min(1).max(200),
  content: Content,
  plannedDate: z.iso.date().nullable().optional(),
});
const Resume = z.strictObject({
  cursor: z.number().int().min(0).max(300000).optional(),
  selectionEnd: z.number().int().min(0).max(300000).optional(),
  scroll: z.number().min(0).max(10000000).optional(),
  windowScroll: z.number().min(0).max(10000000).optional(),
  page: z.number().int().min(1).max(100000).optional(),
  field: z.string().max(50).optional(),
  section: z.string().max(200).optional(),
});
export async function registerDocumentRoutes(app: FastifyInstance) {
  app.get("/v1/documents", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    await limit("search",user.id);
    const q = parse(
      z.object({
        kind: Kind.optional(),
        search: z.string().max(200).default(""),
        date: z.iso.date().optional(),
        subject: z.string().max(200).optional(),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      req.query,
    );
    const result = await pool.query(
      `SELECT id,kind,title,revision,planned_date,updated_at,content->>'subject' AS subject,content->>'grade' AS grade FROM documents WHERE user_id=$1 AND trashed_at IS NULL AND ($2::text IS NULL OR kind=$2) AND ($3='' OR search_vector @@ plainto_tsquery('simple',$3)) AND ($4::date IS NULL OR planned_date=$4) AND ($5::text IS NULL OR content->>'subject'=$5) ORDER BY updated_at DESC,id LIMIT 20 OFFSET $6`,
      [
        user.id,
        q.kind ?? null,
        q.search.trim().length>=2 ? q.search.trim() : "",
        q.date ?? null,
        q.subject ?? null,
        q.offset,
      ],
    );
    return { items: result.rows };
  });
  app.post("/v1/documents", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    await limit("workspaceWrite", user.id);
    const b = parse(DocumentInput.extend({ kind: Kind }), req.body);
    const result = await transaction(async (c) => {
      await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
      const count = await c.query(
        "SELECT count(*) FROM documents WHERE user_id=$1",
        [user.id],
      );
      if (Number(count.rows[0].count) >= 10000)
        throw failure(413, "Document limit reached.");
      return c.query(
        "INSERT INTO documents(user_id,kind,title,content,planned_date) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [user.id, b.kind, b.title, b.content, b.plannedDate ?? null],
      );
    });
    return reply.code(201).send({ item: result.rows[0] });
  });
  app.get("/v1/documents/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const id = itemId(req);
    const result = await pool.query(
      "SELECT * FROM documents WHERE id=$1 AND user_id=$2 AND trashed_at IS NULL",
      [id, user.id],
    );
    if (!result.rows[0]) throw failure(404, "Document not found.");
    const resume = await pool.query(
      "SELECT state FROM resume_state WHERE user_id=$1 AND document_id=$2",
      [user.id, id],
    );
    const resources = await pool.query(
      `SELECT r.id,r.title,r.mime FROM resources r JOIN lesson_resources l ON l.resource_id=r.id AND l.user_id=r.user_id WHERE l.document_id=$1 AND l.user_id=$2 AND r.status='ready'`,
      [id, user.id],
    );
    return {
      item: result.rows[0],
      resume: resume.rows[0]?.state ?? {},
      resources: resources.rows,
    };
  });
  app.patch("/v1/documents/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    await limit("workspaceWrite", user.id);
    const id = itemId(req),
      b = parse(
        DocumentInput.extend({ revision: z.number().int().positive() }),
        req.body,
      );
    const item = await transaction(async (c) => {
      await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE",[user.id]);
      const old = await c.query(
        "SELECT * FROM documents WHERE id=$1 AND user_id=$2 AND trashed_at IS NULL FOR UPDATE",
        [id, user.id],
      );
      const row = old.rows[0];
      if (!row) throw failure(404, "Document not found.");
      if (row.revision !== b.revision)
        throw failure(
          409,
          "A newer revision exists. Keep your draft and review the latest version.",
        );
      await c.query(
        "INSERT INTO document_revisions(document_id,revision,title,content) SELECT $1,$2,$3,$4 WHERE NOT EXISTS(SELECT 1 FROM document_revisions WHERE document_id=$1 AND created_at>now()-interval '5 minutes')",
        [id, row.revision, row.title, row.content],
      );
      const updated = await c.query(
        "UPDATE documents SET title=$3,content=$4,planned_date=$5,revision=revision+1,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *",
        [id, user.id, b.title, b.content, b.plannedDate ?? null],
      );
      await c.query(
        "DELETE FROM document_revisions WHERE document_id=$1 AND (created_at<now()-interval '30 days' OR revision NOT IN (SELECT revision FROM document_revisions WHERE document_id=$1 ORDER BY revision DESC LIMIT 50))",
        [id],
      );
      return updated.rows[0];
    });
    return { item };
  });
  app.get("/v1/documents/:id/revisions", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    return {
      items: (
        await pool.query(
          "SELECT r.* FROM document_revisions r JOIN documents d ON d.id=r.document_id WHERE d.id=$1 AND d.user_id=$2 ORDER BY revision DESC LIMIT 50",
          [itemId(req), user.id],
        )
      ).rows,
    };
  });
  app.delete("/v1/documents/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const b = parse(
      z.strictObject({ revision: z.number().int().positive() }),
      req.body,
    );
    const result = await pool.query(
      "UPDATE documents SET trashed_at=now() WHERE id=$1 AND user_id=$2 AND revision=$3 AND trashed_at IS NULL",
      [itemId(req), user.id, b.revision],
    );
    if (!result.rowCount)
      throw failure(
        409,
        "Document changed or was deleted. Refresh before deleting.",
      );
    return { ok: true };
  });
  app.post("/v1/documents/:id/copy", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    await limit("workspaceWrite", user.id);
    const b = parse(
      z.strictObject({ kind: Kind, title: z.string().trim().min(1).max(200) }),
      req.body,
    );
    const item = await transaction(async (c) => {
      await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
      const count = await c.query(
        "SELECT count(*) FROM documents WHERE user_id=$1",
        [user.id],
      );
      if (Number(count.rows[0].count) >= 10000)
        throw failure(413, "Document limit reached.");
      const result = await c.query(
        `INSERT INTO documents(user_id,kind,title,content) SELECT user_id,$3,$4,content - 'date' FROM documents WHERE id=$1 AND user_id=$2 AND trashed_at IS NULL RETURNING *`,
        [itemId(req), user.id, b.kind, b.title],
      );
      if (!result.rows[0]) throw failure(404, "Document not found.");
      if (b.kind === "lesson")
        await c.query(
          "INSERT INTO lesson_resources(document_id,resource_id,user_id) SELECT $3,l.resource_id,l.user_id FROM lesson_resources l JOIN resources r ON r.id=l.resource_id AND r.user_id=l.user_id WHERE l.document_id=$1 AND l.user_id=$2 AND r.status='ready'",
          [itemId(req), user.id, result.rows[0].id],
        );
      return result.rows[0];
    });
    return reply.code(201).send({ item });
  });
  app.put("/v1/documents/:id/resources/:resourceId", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const p = parse(
      z.object({ id: z.uuid(), resourceId: z.uuid() }),
      req.params,
    );
    const result = await pool.query(
      `INSERT INTO lesson_resources(document_id,resource_id,user_id) SELECT d.id,r.id,d.user_id FROM documents d JOIN resources r ON r.user_id=d.user_id WHERE d.id=$1 AND d.user_id=$2 AND d.trashed_at IS NULL AND d.kind='lesson' AND r.id=$3 AND r.status='ready' ON CONFLICT DO NOTHING RETURNING resource_id`,
      [p.id, user.id, p.resourceId],
    );
    if (!result.rowCount)
      throw failure(404, "Resource unavailable or already attached.");
    return { ok: true };
  });
  app.delete("/v1/documents/:id/resources/:resourceId", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const p = parse(
      z.object({ id: z.uuid(), resourceId: z.uuid() }),
      req.params,
    );
    await pool.query(
      "DELETE FROM lesson_resources WHERE document_id=$1 AND resource_id=$2 AND user_id=$3",
      [p.id, p.resourceId, user.id],
    );
    return { ok: true };
  });
  app.put("/v1/resume/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const b = parse(
        z.strictObject({
          kind: z.enum(["document", "resource"]),
          state: Resume,
        }),
        req.body,
      ),
      id = itemId(req);
    const isDoc = b.kind === "document";
    // Identifiers are constants chosen from the validated enum, never user SQL.
    const table = isDoc ? "documents" : "resources",
      column = isDoc ? "document_id" : "resource_id";
    const result = await pool.query(
      `INSERT INTO resume_state(user_id,${column},state) SELECT user_id,id,$3 FROM ${table} WHERE id=$1 AND user_id=$2 AND ${isDoc ? "trashed_at IS NULL" : "status='ready'"} ON CONFLICT(user_id,item_id) DO UPDATE SET state=$3,opened_at=now() RETURNING item_id`,
      [id, user.id, b.state],
    );
    if (!result.rowCount) throw failure(404, "Item not found.");
    return { ok: true };
  });
  app.get("/v1/workspace", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const tz=(await pool.query("SELECT timezone FROM users WHERE id=$1",[user.id])).rows[0].timezone;
    const q={today:new Date().toLocaleDateString("en-CA",{timeZone:tz})};
    const [resume, notes, files, lessons, activity] = await Promise.all([
      pool.query(
        `SELECT s.*,coalesce(d.title,r.title) AS title,coalesce(d.kind,'file') AS kind FROM resume_state s LEFT JOIN documents d ON d.id=s.document_id LEFT JOIN resources r ON r.id=s.resource_id WHERE s.user_id=$1 AND ((d.id IS NOT NULL AND d.trashed_at IS NULL) OR r.status='ready') ORDER BY s.opened_at DESC LIMIT 6`,
        [user.id],
      ),
      pool.query(
        "SELECT id,title,updated_at FROM documents WHERE user_id=$1 AND trashed_at IS NULL AND kind='note' ORDER BY updated_at DESC LIMIT 5",
        [user.id],
      ),
      pool.query(
        "SELECT id,title,created_at FROM resources WHERE user_id=$1 AND status='ready' ORDER BY created_at DESC LIMIT 5",
        [user.id],
      ),
      pool.query(
        "SELECT id,title,planned_date,content->>'subject' AS subject FROM documents WHERE user_id=$1 AND trashed_at IS NULL AND kind='lesson' AND planned_date >= $2 ORDER BY planned_date,id LIMIT 30",
        [user.id, q.today],
      ),
      pool.query(
        "SELECT id,title,kind,updated_at FROM documents WHERE user_id=$1 AND trashed_at IS NULL ORDER BY updated_at DESC LIMIT 8",
        [user.id],
      ),
    ]);
    return {
      resume: resume.rows,
      notes: notes.rows,
      files: files.rows,
      lessons: lessons.rows,
      activity: activity.rows,
    };
  });
}
