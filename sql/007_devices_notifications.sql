CREATE TABLE trusted_devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash bytea NOT NULL UNIQUE, label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL, revoked_at timestamptz, UNIQUE(id,user_id)
);
ALTER TABLE sessions ADD COLUMN device_id uuid;
ALTER TABLE sessions ADD CONSTRAINT sessions_device_owner FOREIGN KEY(device_id,user_id) REFERENCES trusted_devices(id,user_id) ON DELETE CASCADE;
CREATE TABLE device_challenges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash bytea NOT NULL UNIQUE, matching_number integer NOT NULL CHECK(matching_number BETWEEN 10 AND 99),
 label text NOT NULL, ip inet, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied','consumed')),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), decided_by uuid REFERENCES trusted_devices(id) ON DELETE SET NULL
);
CREATE INDEX device_challenges_pending ON device_challenges(user_id,expires_at) WHERE status='pending';
CREATE INDEX trusted_devices_owner ON trusted_devices(user_id);
CREATE TABLE recovery_codes (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash bytea PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE security_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 event text NOT NULL, ip inet, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_events_owner ON security_events(user_id,created_at DESC);
CREATE TABLE notification_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id) ON DELETE CASCADE,
 recipient text NOT NULL, subject text NOT NULL, encrypted_body text NOT NULL,
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '1 day', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_pending ON notification_outbox(available_at);
-- An admin's own audit history must not make account deletion impossible.
ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_log_admin_user_id_fkey;
ALTER TABLE admin_audit_log ALTER COLUMN admin_user_id DROP NOT NULL;
ALTER TABLE admin_audit_log ADD FOREIGN KEY(admin_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE device_challenges ADD COLUMN recovery_hash bytea;
