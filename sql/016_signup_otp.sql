-- Country is optional; preserve existing account data.
ALTER TABLE users ALTER COLUMN country DROP NOT NULL;
ALTER TABLE email_tokens ADD COLUMN attempts integer NOT NULL DEFAULT 0;
-- Existing signup links must not bypass the new required OTP step.
UPDATE email_tokens SET used_at=now() WHERE purpose='verify_email' AND used_at IS NULL;
