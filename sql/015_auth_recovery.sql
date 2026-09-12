-- Recovery codes are one-time, expiring credentials, including previously
-- generated codes. New issuance supplies the configured lifetime explicitly.
ALTER TABLE recovery_codes ADD COLUMN expires_at timestamptz NOT NULL DEFAULT now()+interval '365 days';
CREATE INDEX recovery_codes_expiry_idx ON recovery_codes(expires_at);
