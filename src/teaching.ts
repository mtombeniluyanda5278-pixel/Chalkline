import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "./db.js";
import { transaction } from "./transactions.js";
import { requireUser } from "./auth.js";
import { failure, parse, itemId, limit } from "./http.js";
import { config } from "./config.js";
import { readTimetablePhoto } from "./timetablePhoto.js";
const name = z.string().trim().min(1).max(100);
const grade = z.number().int().min(8).max(12);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const timetable = z
  .array(
    z.strictObject({
      day: z.number().int().min(1).max(7),
      start: time,
      end: time,
      title: name,
      room: z.string().trim().max(100).default(""),
    }),
  )
  .max(100)
  .superRefine((entries, ctx) => {
    for (const [i, entry] of entries.entries()) {
      if (entry.end <= entry.start)
        ctx.addIssue({
          code: "custom",
          message: "End time must be after start time.",
          path: [i, "end"],
        });
      if (
        entries
          .slice(0, i)
          .some(
            (other) =>
              other.day === entry.day &&
              other.start < entry.end &&
              entry.start < other.end,
          )
      )
        ctx.addIssue({
          code: "custom",
          message: "Timetable periods for the same class cannot overlap.",
          path: [i],
        });
    }
  });
export const LessonMetadata = z.strictObject({
  workspaceId: z.uuid().nullable(),
  term: z.number().int().min(1).max(4).nullable(),
  week: z.number().int().min(1).max(53).nullable(),
  status: z.enum(["Draft", "Planned", "Taught", "Needs review"]),
});
export async function ownedWorkspace(
  c: Pick<PoolClient, "query">,
  user: string,
  id: string,
  active = false,
) {
  const r = await c.query(
    `SELECT w.*,s.name AS subject,c.name AS class,c.grade,s.archived_at AS subject_archived,c.archived_at AS class_archived FROM teaching_workspaces w JOIN teaching_subjects s ON s.id=w.subject_id AND s.user_id=w.user_id JOIN teaching_classes c ON c.id=w.class_id AND c.user_id=w.user_id WHERE w.id=$1 AND w.user_id=$2 ${active ? "AND s.archived_at IS NULL AND c.archived_at IS NULL AND c.grade=ANY(s.grades)" : ""}`,
    [id, user],
  );
  if (!r.rows[0]) throw failure(404, "Class workspace unavailable.");
  return r.rows[0];
}
export async function registerTeachingRoutes(app: FastifyInstance) {
  app.post(
    "/v1/teaching/classes/:id/timetable/photo",
    { bodyLimit: 6 * 1024 * 1024 },
    async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user) return;
      await limit("timetablePhoto", user.id);
      const cls = await pool.query(
        "SELECT name FROM teaching_classes WHERE id=$1 AND user_id=$2 AND archived_at IS NULL",
        [itemId(req), user.id],
      );
      if (!cls.rows[0]) throw failure(404, "Active class not found.");
      const body = parse(
        z.strictObject({ image: z.string().max(5_600_000) }),
        req.body,
      );
      return readTimetablePhoto(body.image, cls.rows[0].name, {
        key: config.OPENAI_API_KEY,
        model: config.TIMETABLE_VISION_MODEL,
      });
    },
  );
  app.put("/v1/teaching/classes/:id/timetable", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    await limit("workspaceWrite", user.id);
    const body = parse(z.strictObject({ entries: timetable }), req.body);
    const result = await pool.query(
      "UPDATE teaching_classes SET timetable=$3::jsonb WHERE id=$1 AND user_id=$2 AND archived_at IS NULL RETURNING timetable",
      [itemId(req), user.id, JSON.stringify(body.entries)],
    );
    if (!result.rowCount) throw failure(404, "Active class not found.");
    return { entries: result.rows[0].timetable };
  });
  app.get("/v1/teaching", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const [subjects, classes, workspaces] = await Promise.all(
      ["teaching_subjects", "teaching_classes", "teaching_workspaces"].map(
        (table) =>
          pool.query(`SELECT * FROM ${table} WHERE user_id=$1 ORDER BY id`, [
            user.id,
          ]),
      ),
    );
    return {
      photoImportAvailable: Boolean(config.OPENAI_API_KEY),
      subjects: subjects!.rows,
      classes: classes!.rows,
      workspaces: workspaces!.rows,
    };
  });
  for (const kind of ["subjects", "classes"] as const) {
    const table =
      kind === "subjects" ? "teaching_subjects" : "teaching_classes";
    const schema =
      kind === "subjects"
        ? z.strictObject({ name, grades: z.array(grade).min(1).max(5) })
        : z.strictObject({ name, grade });
    app.post("/v1/teaching/" + kind, async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user) return;
      await limit("workspaceWrite", user.id);
      const b = parse(
        schema as z.ZodType<{
          name: string;
          grades?: number[];
          grade?: number;
        }>,
        req.body,
      );
      const item = await transaction(async (c) => {
        await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
        if (
          Number(
            (
              await c.query(`SELECT count(*) FROM ${table} WHERE user_id=$1`, [
                user.id,
              ])
            ).rows[0].count,
          ) >= 200
        )
          throw failure(413, "Directory limit reached.");
        return (
          await c.query(
            `INSERT INTO ${table}(user_id,name,${kind === "subjects" ? "grades" : "grade"}) VALUES($1,$2,$3) RETURNING *`,
            [user.id, b.name, b.grades ? [...new Set(b.grades)] : b.grade],
          )
        ).rows[0];
      });
      return reply.code(201).send({ item });
    });
    app.patch("/v1/teaching/" + kind + "/:id", async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user) return;
      await limit("workspaceWrite", user.id);
      const b = parse(
        z.strictObject({
          name: name.optional(),
          archived: z.boolean().optional(),
          grades:
            kind === "subjects"
              ? z.array(grade).min(1).max(5).optional()
              : z.never().optional(),
        }),
        req.body,
      );
      const item = await transaction(async (c) => {
        await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
        const old = (
          await c.query(
            `SELECT * FROM ${table} WHERE id=$1 AND user_id=$2 FOR UPDATE`,
            [itemId(req), user.id],
          )
        ).rows[0];
        if (!old) throw failure(404, "Directory item not found.");
        if (b.grades) {
          const used = await c.query(
            "SELECT c.grade FROM teaching_workspaces w JOIN teaching_classes c ON c.id=w.class_id WHERE w.subject_id=$1 AND w.user_id=$2",
            [old.id, user.id],
          );
          if (used.rows.some((r) => !b.grades!.includes(r.grade)))
            throw failure(
              409,
              "Keep grades that have linked classes. Archive the subject to preserve its content.",
            );
        }
        return (
          await c.query(
            `UPDATE ${table} SET name=$3,archived_at=$4 ${kind === "subjects" ? ",grades=$5" : ""} WHERE id=$1 AND user_id=$2 RETURNING *`,
            [
              old.id,
              user.id,
              b.name ?? old.name,
              b.archived === undefined
                ? old.archived_at
                : b.archived
                  ? new Date()
                  : null,
              ...(kind === "subjects" ? [b.grades ?? old.grades] : []),
            ],
          )
        ).rows[0];
      });
      return { item };
    });
  }
  app.post("/v1/teaching/workspaces", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    await limit("workspaceWrite", user.id);
    const b = parse(
      z.strictObject({ subjectId: z.uuid(), classId: z.uuid() }),
      req.body,
    );
    const item = await transaction(async (c) => {
      await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
      const r = await c.query(
        `INSERT INTO teaching_workspaces(user_id,subject_id,class_id) SELECT s.user_id,s.id,c.id FROM teaching_subjects s JOIN teaching_classes c ON c.user_id=s.user_id WHERE s.id=$1 AND c.id=$2 AND s.user_id=$3 AND c.grade=ANY(s.grades) AND s.archived_at IS NULL AND c.archived_at IS NULL ON CONFLICT(subject_id,class_id) DO UPDATE SET subject_id=excluded.subject_id RETURNING *`,
        [b.subjectId, b.classId, user.id],
      );
      if (!r.rows[0])
        throw failure(
          404,
          "Choose an active subject and a class in one of its grades.",
        );
      return r.rows[0];
    });
    return reply.code(201).send({ item });
  });
  app.get("/v1/teaching/workspaces/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const item = await ownedWorkspace(pool, user.id, itemId(req));
    const last = await pool.query(
      `SELECT d.id,d.title FROM resume_state r JOIN documents d ON d.id=r.document_id AND d.user_id=r.user_id WHERE r.user_id=$1 AND d.workspace_id=$2 AND d.trashed_at IS NULL ORDER BY r.opened_at DESC LIMIT 1`,
      [user.id, item.id],
    );
    const coverage = await pool.query(
      `SELECT count(*)::int AS total,count(*) FILTER(WHERE lesson_status='Taught')::int AS taught FROM documents WHERE user_id=$1 AND workspace_id=$2 AND trashed_at IS NULL`,
      [user.id, item.id],
    );
    return { item, last: last.rows[0] ?? null, coverage: coverage.rows[0] };
  });
  app.get("/v1/teaching/classes/:id/learners", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (
      !(
        await pool.query(
          "SELECT id FROM teaching_classes WHERE id=$1 AND user_id=$2",
          [itemId(req), user.id],
        )
      ).rowCount
    )
      throw failure(404, "Class not found.");
    return {
      items: (
        await pool.query(
          "SELECT id,name,identifier FROM teaching_learners WHERE class_id=$1 AND user_id=$2 ORDER BY name,id",
          [itemId(req), user.id],
        )
      ).rows,
    };
  });
  app.post("/v1/teaching/classes/:id/learners", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    await limit("workspaceWrite", user.id);
    const b = parse(
      z.strictObject({
        name: z.string().trim().min(1).max(200),
        identifier: z.string().trim().max(100).default(""),
      }),
      req.body,
    );
    const item = await transaction(async (c) => {
      await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
      if (
        Number(
          (
            await c.query(
              "SELECT count(*) FROM teaching_learners WHERE class_id=$1 AND user_id=$2",
              [itemId(req), user.id],
            )
          ).rows[0].count,
        ) >= 500
      )
        throw failure(413, "Class list limit reached.");
      const r = await c.query(
        "INSERT INTO teaching_learners(user_id,class_id,name,identifier) SELECT user_id,id,$3,$4 FROM teaching_classes WHERE id=$1 AND user_id=$2 AND archived_at IS NULL RETURNING *",
        [itemId(req), user.id, b.name, b.identifier],
      );
      if (!r.rows[0]) throw failure(404, "Class unavailable.");
      return r.rows[0];
    });
    return reply.code(201).send({ item });
  });
  app.patch("/v1/teaching/learners/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    await limit("workspaceWrite", user.id);
    const b = parse(
      z.strictObject({
        name: z.string().trim().min(1).max(200),
        identifier: z.string().trim().max(100).default(""),
      }),
      req.body,
    );
    const r = await pool.query(
      "UPDATE teaching_learners SET name=$3,identifier=$4 WHERE id=$1 AND user_id=$2 RETURNING *",
      [itemId(req), user.id, b.name, b.identifier],
    );
    if (!r.rowCount) throw failure(404, "Learner not found.");
    return { item: r.rows[0] };
  });
  app.delete("/v1/teaching/learners/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const r = await pool.query(
      "DELETE FROM teaching_learners WHERE id=$1 AND user_id=$2",
      [itemId(req), user.id],
    );
    if (!r.rowCount) throw failure(404, "Learner not found.");
    return { ok: true };
  });
  app.get("/v1/teaching/workspaces/:id/resources", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    await ownedWorkspace(pool, user.id, itemId(req));
    return {
      items: (
        await pool.query(
          `SELECT r.id,r.title,r.mime,r.category,r.external_url FROM resources r JOIN class_resources l ON l.resource_id=r.id AND l.user_id=r.user_id WHERE l.workspace_id=$1 AND l.user_id=$2 AND r.status='ready' AND (r.scanned_at IS NOT NULL OR r.external_url IS NOT NULL) ORDER BY r.title`,
          [itemId(req), user.id],
        )
      ).rows,
    };
  });
  for (const method of ["PUT", "DELETE"] as const)
    app.route({
      method,
      url: "/v1/teaching/workspaces/:id/resources/:resourceId",
      handler: async (req, reply) => {
        const user = await requireUser(req, reply);
        if (!user) return;
        await limit("workspaceWrite", user.id);
        const p = parse(
          z.object({ id: z.uuid(), resourceId: z.uuid() }),
          req.params,
        );
        await transaction(async (c) => {
          await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
            user.id,
          ]);
          await ownedWorkspace(c, user.id, p.id, method === "PUT");
          if (
            !(
              await c.query(
                `SELECT id FROM resources WHERE id=$1 AND user_id=$2 AND status='ready' AND (scanned_at IS NOT NULL OR external_url IS NOT NULL)`,
                [p.resourceId, user.id],
              )
            ).rowCount
          )
            throw failure(404, "Resource unavailable.");
          if (method === "PUT")
            await c.query(
              "INSERT INTO class_resources(workspace_id,resource_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
              [p.id, p.resourceId, user.id],
            );
          else
            await c.query(
              "DELETE FROM class_resources WHERE workspace_id=$1 AND resource_id=$2 AND user_id=$3",
              [p.id, p.resourceId, user.id],
            );
        });
        return { ok: true };
      },
    });
}
