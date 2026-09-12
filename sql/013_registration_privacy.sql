-- Existing accounts keep their established sign-in behavior.
-- Only new registrations wait for email proof before their first session.
ALTER TABLE users
  ADD COLUMN registration_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN registration_trust_device boolean NOT NULL DEFAULT false;
