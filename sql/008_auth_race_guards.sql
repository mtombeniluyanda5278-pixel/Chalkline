-- Bind sessions and pre-authentication challenges to the credential generation.
ALTER TABLE users ADD COLUMN auth_epoch integer NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN auth_epoch integer NOT NULL DEFAULT 0;
ALTER TABLE device_challenges ADD COLUMN auth_epoch integer NOT NULL DEFAULT 0;
ALTER TABLE email_tokens ADD COLUMN target_email citext;
UPDATE email_tokens t SET target_email=u.email FROM users u WHERE u.id=t.user_id;
