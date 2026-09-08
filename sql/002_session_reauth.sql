-- Tracks the last time a session proved *fresh* authentication (password
-- entry, passkey login, or a successful current-password re-check), as
-- opposed to just holding a valid-but-possibly-old cookie.
--
-- Used to gate sensitive actions (e.g. registering a new passkey) behind a
-- short "step-up" window, separate from the much longer session TTL.
--
-- NOTE: sql/001_init.sql and files in this directory only run automatically
-- on a brand-new, empty Postgres volume (docker-entrypoint-initdb.d runs
-- *.sql files in filename order on first init only). If you already have a
-- running volume from before this file existed, apply it by hand:
--   docker compose exec postgres psql -U chalkline -d chalkline -f /docker-entrypoint-initdb.d/002_session_reauth.sql
-- or `docker compose down -v && docker compose up -d` to reinit from empty.

ALTER TABLE sessions
  ADD COLUMN reauthenticated_at timestamptz NOT NULL DEFAULT now();