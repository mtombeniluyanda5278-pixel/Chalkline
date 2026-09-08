-- Ran automatically on first Postgres container start (empty volume only).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               citext NOT NULL UNIQUE,
  email_verified_at   timestamptz,
  username            citext NOT NULL UNIQUE,
  password_hash       text,
  first_name          text NOT NULL,
  last_name           text NOT NULL,
  country             char(2) NOT NULL,
  date_of_birth       date NOT NULL,
  phone_e164          text,
  phone_verified_at   timestamptz,
  marketing_announcements boolean NOT NULL DEFAULT false,
  marketing_apps      boolean NOT NULL DEFAULT false,
  consents_at         timestamptz,
  failed_login_count  integer NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_phone_e164_format CHECK (
    phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  CONSTRAINT users_country_iso CHECK (country ~ '^[A-Z]{2}$'),
  CONSTRAINT users_username_format CHECK (username ~ '^[a-z0-9._]{3,20}$')
);

CREATE TABLE addresses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  line1        text NOT NULL,
  line2        text,
  city         text NOT NULL,
  region       text,
  postal_code  text NOT NULL,
  country      char(2) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT addresses_country_iso CHECK (country ~ '^[A-Z]{2}$')
);

-- Store SHA-256 of the cookie value, not the raw token.
CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash    bytea NOT NULL UNIQUE,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  ip            inet,
  user_agent    text
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE email_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose      text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash   bytea NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webauthn_credentials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  credential_id   bytea NOT NULL UNIQUE,
  public_key      bytea NOT NULL,
  counter         bigint NOT NULL DEFAULT 0,
  device_name     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webauthn_credentials_user_id_idx ON webauthn_credentials (user_id);

-- RLS is enabled so a *non-owner* DB role cannot dump the whole table.
-- The Docker role "chalkline" owns these tables, so THIS local role bypasses RLS
-- unless you FORCE RLS and connect as a restricted app user. See README.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE webauthn_credentials ENABLE ROW LEVEL SECURITY;
