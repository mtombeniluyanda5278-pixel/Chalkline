-- Change 19A: database hardening

-- Prevent impossible negative login-attempt counts.
ALTER TABLE users
  ADD CONSTRAINT users_failed_login_count_nonnegative
  CHECK (failed_login_count >= 0);

-- Prevent impossible negative WebAuthn signature counters.
ALTER TABLE webauthn_credentials
  ADD CONSTRAINT webauthn_credentials_counter_nonnegative
  CHECK (counter >= 0);

-- Speed up cleanup/lookups of expired email tokens.
CREATE INDEX IF NOT EXISTS email_tokens_expires_at_idx
  ON email_tokens (expires_at);

-- Speed up lookup of active tokens by user/purpose.
CREATE INDEX IF NOT EXISTS email_tokens_user_purpose_active_idx
  ON email_tokens (user_id, purpose)
  WHERE used_at IS NULL;