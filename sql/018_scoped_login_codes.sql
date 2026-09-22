-- Preserve existing challenges and credentials; scope resends to their flow.
ALTER TABLE login_codes DROP CONSTRAINT login_codes_pkey;
ALTER TABLE login_codes ADD PRIMARY KEY (issuance);
CREATE UNIQUE INDEX login_codes_login_scope ON login_codes(user_id) WHERE session_id IS NULL;
CREATE UNIQUE INDEX login_codes_reauth_scope ON login_codes(user_id,session_id) WHERE session_id IS NOT NULL;
ALTER TABLE users ADD COLUMN otp_failed_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN otp_attempt_window timestamptz NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN otp_delivery_count integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN otp_delivery_window timestamptz NOT NULL DEFAULT now();
-- Bind outstanding and future email links to the security epoch.
ALTER TABLE email_tokens ADD COLUMN auth_epoch integer;
UPDATE email_tokens t SET auth_epoch=u.auth_epoch FROM users u WHERE u.id=t.user_id;
