import { z } from "zod";
const amount = z.coerce.number().finite().min(0).max(1e9).optional();
export const AudienceFilters = z
  .strictObject({
    plan: z.string().trim().min(1).max(80).optional(),
    ageMin: z.coerce.number().int().min(0).max(150).optional(),
    ageMax: z.coerce.number().int().min(0).max(150).optional(),
    createdFrom: z.iso.date().optional(),
    createdTo: z.iso.date().optional(),
    storageMinMb: amount,
    storageMaxMb: amount,
    capacityMinMb: amount,
    capacityMaxMb: amount,
    usageMinPct: amount,
    usageMaxPct: amount,
  })
  .superRefine((value, ctx) => {
    for (const [min, max] of [
      [value.ageMin, value.ageMax],
      [value.createdFrom, value.createdTo],
      [value.storageMinMb, value.storageMaxMb],
      [value.capacityMinMb, value.capacityMaxMb],
      [value.usageMinPct, value.usageMaxPct],
    ])
      if (min !== undefined && max !== undefined && min > max)
        ctx.addIssue({
          code: "custom",
          message: "Minimum must not exceed maximum.",
        });
  });
export type Audience = z.infer<typeof AudienceFilters>;
export const accountMetrics = `SELECT u.id,u.first_name,left(u.last_name,1) AS last_initial,u.email,
 u.email_verified_at IS NOT NULL AS primary_verified,u.recovery_verified_at IS NOT NULL AS recovery_verified,
 u.onboarding_completed_at IS NOT NULL AS onboarded,u.suspended_at IS NOT NULL AS suspended,u.registration_pending,
 u.marketing_announcements,
 EXISTS(SELECT 1 FROM webauthn_credentials w WHERE w.user_id=u.id) AS has_passkey,
 EXISTS(SELECT 1 FROM trusted_devices d WHERE d.user_id=u.id AND revoked_at IS NULL AND expires_at>now()) AS has_device,
 u.created_at,extract(year from age(CURRENT_DATE,u.date_of_birth))::int AS age,
 p.code AS plan,coalesce(x.storage_used_bytes,0) AS storage_used_bytes,p.storage_quota_bytes,
 coalesce(x.document_used_bytes,0) AS document_used_bytes,p.document_quota_bytes,
 CASE WHEN p.document_quota_bytes=0 THEN CASE WHEN coalesce(x.document_used_bytes,0)=0 THEN 0 ELSE 100 END
 ELSE round(100.0*coalesce(x.document_used_bytes,0)/p.document_quota_bytes,2) END AS document_usage_pct
 FROM users u LEFT JOIN user_usage x ON x.user_id=u.id
 LEFT JOIN user_plan_assignments a ON a.user_id=u.id
 JOIN plans p ON p.code=CASE WHEN u.email_verified_at IS NULL THEN 'UNVERIFIED' ELSE coalesce(a.plan_code,'FREE_BETA') END`;
export function audienceWhere(
  filters: Audience,
  kind?: "service" | "announcement",
) {
  const values: unknown[] = [],
    clauses: string[] = [];
  const add = (sql: string, value: unknown) => {
    if (value !== undefined) {
      values.push(value);
      clauses.push(sql.replace("?", "$" + values.length));
    }
  };
  add("plan=?", filters.plan);
  add("age>=?", filters.ageMin);
  add("age<=?", filters.ageMax);
  add("created_at >= ?::date AT TIME ZONE 'UTC'", filters.createdFrom);
  add(
    "created_at < (?::date + interval '1 day') AT TIME ZONE 'UTC'",
    filters.createdTo,
  );
  add("storage_used_bytes>=?::numeric*1048576", filters.storageMinMb);
  add("storage_used_bytes<=?::numeric*1048576", filters.storageMaxMb);
  add("storage_quota_bytes>=?::numeric*1048576", filters.capacityMinMb);
  add("storage_quota_bytes<=?::numeric*1048576", filters.capacityMaxMb);
  add("document_usage_pct>=?", filters.usageMinPct);
  add("document_usage_pct<=?", filters.usageMaxPct);
  if (kind)
    clauses.push(
      "primary_verified AND NOT suspended AND NOT registration_pending",
    );
  if (kind === "announcement") clauses.push("marketing_announcements");
  return {
    sql: clauses.length ? " WHERE " + clauses.join(" AND ") : "",
    values,
  };
}
