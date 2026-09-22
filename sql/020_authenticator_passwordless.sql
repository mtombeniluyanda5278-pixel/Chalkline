CREATE TABLE authenticators (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_secret text NOT NULL,
  last_step bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE authenticator_enrollments (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  encrypted_secret text NOT NULL,
  expires_at timestamptz NOT NULL
);
ALTER TABLE sessions DROP CONSTRAINT sessions_auth_method_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_auth_method_check
  CHECK (auth_method IN ('password','passkey','email_otp','google','totp'));
-- Retire saved passwords and their sessions; keep users and all teaching content.
UPDATE users SET password_hash=NULL, auth_epoch=auth_epoch+1 WHERE password_hash IS NOT NULL;
DELETE FROM sessions s USING users u WHERE s.user_id=u.id AND s.auth_epoch<>u.auth_epoch;
DELETE FROM email_tokens WHERE purpose='reset_password';
ALTER TABLE users ADD CONSTRAINT password_auth_retired CHECK (password_hash IS NULL);
