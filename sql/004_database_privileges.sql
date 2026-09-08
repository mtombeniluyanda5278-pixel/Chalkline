-- Change 19B: database privilege hardening

-- Prevent the default public schema from being writable by arbitrary roles.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Keep schema usage available to existing application roles.
GRANT USAGE ON SCHEMA public TO PUBLIC;