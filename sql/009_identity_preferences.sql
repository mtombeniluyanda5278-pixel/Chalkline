ALTER TABLE users
 ADD COLUMN recovery_email citext,
 ADD COLUMN recovery_verified_at timestamptz,
 ADD COLUMN pending_recovery_email citext,
 ADD COLUMN session_days integer NOT NULL DEFAULT 30 CHECK(session_days IN (1,7,30,90)),
 ADD COLUMN timezone text NOT NULL DEFAULT 'Africa/Johannesburg',
 ADD COLUMN personal_touches boolean NOT NULL DEFAULT true,
 ADD COLUMN educator_profile jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(educator_profile)='object'),
 ADD COLUMN onboarding_completed_at timestamptz,
 ADD COLUMN suspended_at timestamptz,
 ADD CONSTRAINT recovery_verified_pair CHECK ((recovery_email IS NULL)=(recovery_verified_at IS NULL)),
 ADD CONSTRAINT recovery_not_primary CHECK(recovery_email IS NULL OR recovery_email<>email);
CREATE INDEX users_recovery_verified ON users(recovery_email) WHERE recovery_verified_at IS NOT NULL;
ALTER TABLE sessions ADD COLUMN last_active_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN idle_seconds integer NOT NULL DEFAULT 1209600 CHECK(idle_seconds>0),
 ADD COLUMN auth_method text NOT NULL DEFAULT 'password' CHECK(auth_method IN ('password','passkey'));
ALTER TABLE email_tokens DROP CONSTRAINT email_tokens_purpose_check;
ALTER TABLE email_tokens ADD CONSTRAINT email_tokens_purpose_check CHECK(purpose IN ('verify_email','reset_password','verify_recovery','change_email','account_discovery'));
ALTER TABLE email_tokens ADD COLUMN channel text NOT NULL DEFAULT 'primary' CHECK(channel IN ('primary','recovery'));
ALTER TABLE notification_outbox ADD COLUMN dedupe_key text UNIQUE,
 ADD COLUMN lease_token uuid, ADD COLUMN lease_until timestamptz,
 ADD COLUMN state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sent','dead'));
ALTER TABLE notification_outbox ALTER COLUMN encrypted_body DROP NOT NULL;
ALTER TABLE notification_outbox ALTER COLUMN recipient DROP NOT NULL;
ALTER TABLE security_events ADD COLUMN investigation_hold boolean NOT NULL DEFAULT false;
UPDATE users SET failed_login_count=0,locked_until=NULL;
