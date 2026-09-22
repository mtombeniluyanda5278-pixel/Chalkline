-- Additive: existing accounts and credentials are preserved.
ALTER TABLE users ADD COLUMN google_subject text UNIQUE;
ALTER TABLE sessions DROP CONSTRAINT sessions_auth_method_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_auth_method_check
  CHECK (auth_method IN ('password','passkey','email_otp','google'));
CREATE TABLE login_codes (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  issuance uuid NOT NULL,
  code_hash bytea NOT NULL,
  target_email citext NOT NULL,
  auth_epoch integer NOT NULL,
  session_id uuid REFERENCES sessions(id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  expires_at timestamptz NOT NULL
);
ALTER TABLE login_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY backend_access ON login_codes FOR ALL USING (true) WITH CHECK (true);
