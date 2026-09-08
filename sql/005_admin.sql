-- Change 35A: Admin foundation
--
-- Admin privileges are represented explicitly in the database.
-- Never use the username "admin" as an authorization check.
-- Admin accounts are promoted through a controlled bootstrap operation,
-- not through an HTTP endpoint.

ALTER TABLE users
  ADD COLUMN role text NOT NULL DEFAULT 'user';

ALTER TABLE users
  ADD CONSTRAINT users_role_valid
  CHECK (role IN ('user', 'admin'));

CREATE INDEX users_role_idx
  ON users (role)
  WHERE role = 'admin';

CREATE TABLE admin_audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id  uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  action         text NOT NULL,
  target_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  metadata       jsonb,
  ip             inet,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_log_admin_user_id_idx
  ON admin_audit_log (admin_user_id);

CREATE INDEX admin_audit_log_target_user_id_idx
  ON admin_audit_log (target_user_id);

CREATE INDEX admin_audit_log_created_at_idx
  ON admin_audit_log (created_at);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
