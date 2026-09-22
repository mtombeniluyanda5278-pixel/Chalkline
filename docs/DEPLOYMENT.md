> **Do not deploy this checkpoint.** The second hardening pass is unfinished. New environment configuration, outbox-key migration, regression testing and audits remain unresolved. Read [current handoff](HARDENING-PASS-2.md) first.

# Deployment and operations

## Environment variables

`.env.example` lists all variable names without credentials or provider-specific values.

Required backend settings:

- `DATABASE_URL`: standard PostgreSQL connection string. Neon is supported through `pg`; use the TLS settings in Neon's connection string, including certificate verification. Do not disable certificate verification. A direct connection is preferable for the migration runner's session advisory lock.
- `REDIS_URL`: Redis URL, authenticated and TLS-enabled when remote. Redis is required in all environments and failures reject requests.
- `SESSION_SECRET`: at least 64 characters of cryptographically random secret material. Also derives the authenticated encryption key for queued notification bodies. Changing it makes pending notification bodies unreadable; drain or expire the queue before rotation.
- `NODE_ENV`: `development`, `test`, or `production`.
- `PORT`: backend port, default 3000.
- `COOKIE_SECURE`: `true` in production, `false` only on local HTTP.
- `TRUST_PROXY`: leave blank/`false` for direct connections; otherwise comma-separated trusted proxy IPs/CIDRs. Production rejects unbounded `true`. Configure this for the actual proxy chain; a wrong value can defeat per-IP limits or throttle all clients together.
- `WEBAUTHN_ORIGIN`: exact public frontend origin, without a trailing slash/path. HTTPS is mandatory in production.
- `WEBAUTHN_RP_ID`: public frontend hostname, without scheme, port, or path.
- `WEBAUTHN_RP_NAME`: display name; defaults to Chalkline.
- `MIN_ACCOUNT_AGE_YEARS`: defaults to 13, range 13–21.

Storage settings:

- `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`.
- `UPLOAD_MAX_BYTES`: default and maximum 25 MiB.
- `STORAGE_USER_QUOTA_BYTES`: default 500 MiB per user, additionally capped at 5,000 resources per account.

Use a **private** bucket and bucket-scoped credentials. Backblaze B2 is the preferred target, using its standard S3 endpoint and region. The adapter needs PutObject, GetObject, DeleteObject, ListObjectVersions, and DeleteObjectVersion equivalents. It removes versions and delete markers by exact generated key. Disable retention/object-lock policies that would prevent requested deletion, or explicitly document that retention to users. Restrict who can write to the bucket; application uploads always generate new keys.

No storage credentials or permanent storage URLs are delivered to the browser. Uploads and downloads pass through authenticated backend endpoints; bucket CORS is not required. Confirm frontend proxy and backend request size/time limits permit the configured upload size. Upload bodies are bounded but buffered in memory, so size the backend and edge request limits for concurrency.

Provider references: [Backblaze S3 compatibility](https://www.backblaze.com/docs/cloud-storage-s3-compatible-api), [version-aware deletion](https://www.backblaze.com/apidocs/s3-delete-object), and [listing object versions](https://www.backblaze.com/apidocs/s3-list-object-versions).

Email and notifications:

- `EMAIL_DELIVERY_URL`: HTTPS endpoint for an operator-owned delivery adapter.
- `EMAIL_DELIVERY_TOKEN`: bearer credential for that adapter.
- `EMAIL_REQUIRED`: set `true` in production when email-based verification/recovery is required. Startup fails clearly if the adapter URL or token is absent.
- `ADMIN_NOTIFICATION_EMAIL`: optional account-creation notification destination; no teacher profile details are included.

The adapter contract is a POST with `Authorization: Bearer ...` and JSON `{ "to": "recipient", "subject": "subject", "body": "plain text" }`. A 2xx response acknowledges accepted delivery. Redirects are rejected, requests time out, and failures remain queued for retry. Implement delivery behind this contract with whichever email service you select; Brevo is not embedded in authentication. Keep adapter request bodies and Authorization out of logs.

Notifications work as an encrypted PostgreSQL outbox even without delivery. In production without an adapter, startup warns and queued notifications expire after one day. This does **not** mean email was delivered. Local/test maintenance writes messages to ignored `mail/dev-outbox.txt` (owner-only file permissions). Development messages contain real local test tokens; do not publish or share that directory.

Authentication emails contain frontend fragment links. Tokens are not placed in server URL query strings and are removed from browser history after capture. Reset links last 30 minutes, verification links one day, and device approval/recovery challenges 10 minutes. Queueing does not extend token lifetimes. Email is at-least-once: a crash after acceptance but before queue deletion can deliver a duplicate. Links remain single-use.

Device and retention settings:

- `DEVICE_TRUST_DAYS`: default 90, range 1–180. The server enforces expiry and revocation; User-Agent is descriptive only.
- `SECURITY_RETENTION_DAYS`: default 90, range 7–365.
- Docker convenience settings: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `REDIS_PASSWORD`.

## Device approval and recovery

Registration bootstraps the first trusted browser. A user-verified passkey can also establish browser trust. Password login from an unrecognised browser issues only a pending approval cookie, never a full session. An existing trusted session with recent authentication must enter the number shown in the new browser. The actual challenge is a separate 256-bit secret, stored hashed, bound to the account/browser cookie and credential generation, and single-use.

The dashboard shows pending approvals when loaded; the Devices screen has Refresh. The requesting browser checks every 10 seconds while visible. There are no push notifications or background WebSocket requirements.

Generate and save recovery codes before losing your trusted browsers. Recovery requires a successful password login plus a saved single-use recovery code, or a link sent to a previously verified email address. A user-verified passkey is another path. Recovery revokes old trusted devices and sessions. Password reset changes the password, revokes sessions/trust/recovery codes, and invalidates pending approvals; it does not itself approve a new browser. The verified email recovery path or a passkey is still available.

Existing accounts retain valid sessions through migration. Before enforcing this in a live rollout, ensure existing users have a passkey, saved recovery codes, a verified deliverable email, or an existing session from which they can establish recovery options. An unverified legacy account with no session/passkey/recovery codes cannot safely self-recover; that requires an operator identity-verification procedure. Do not solve that by allowing password-only device approval.

## Migrations and database privileges

Never replay 001–005 against a populated database. Use the explicit migration baseline only after inspecting what was applied. The runner records SHA-256 checksums and serializes migrations with a PostgreSQL advisory lock. Run DDL with an owner/migration role and a direct connection, then use a separate restricted application role.

For a standard PostgreSQL deployment, provision separate roles using an operator's `psql` connection (these names are examples; passwords are prompted, never embedded in SQL or committed files):

```sql
CREATE ROLE chix_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\password chix_migrator
CREATE ROLE chix_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\password chix_runtime
CREATE DATABASE chix OWNER chix_migrator;
REVOKE CONNECT ON DATABASE chix FROM PUBLIC;
GRANT CONNECT ON DATABASE chix TO chix_migrator, chix_runtime;
```

For an existing database, retain its migration owner and data; do not replay the creation procedure. The migration role must own the schema and application tables, and have database CREATE permission for the trusted `citext` and `pgcrypto` extensions (or have the operator install them first). The runtime role must not own objects or inherit other roles. Use verified TLS for remote connections.

In a dedicated operator environment, inject `MIGRATION_DATABASE_URL` (migration role), `DATABASE_URL` (runtime role), and the backend configuration through your secret manager. Both URLs must use the same direct database endpoint. Explicitly set `STORAGE_USER_QUOTA_BYTES`, `FREE_DOCUMENT_QUOTA_BYTES`, `UPLOAD_MAX_BYTES`, `UNVERIFIED_FILE_STORAGE_QUOTA_BYTES`, and `UNVERIFIED_DOCUMENT_QUOTA_BYTES` to the intended allowances, or leave them unset to accept defaults: 524288000, 52428800, 26214400, 0, and 2097152 bytes respectively. `.env.example` lists the variable names; blank values are not the same as unset variables. Then run from the repository root:

```sh
npm ci
npm run db:setup:production
unset MIGRATION_DATABASE_URL
npm run build
```

The setup command does not load `.env`. It repairs migration-owner schema access, applies checksum-checked migrations in order, grants restricted runtime table/sequence access, denies runtime access to `schema_migrations`, creates backend RLS policies, and applies both configured plan allowances. It is repeatable and preserves existing content; changed quotas affect future allowance checks. Run it after each migration release or allowance configuration change, before starting the application. `npm run migrate` alone does **not** perform runtime grants, policies, or plan configuration.

Run `npm start` in a separate application environment containing only the runtime `DATABASE_URL` and application settings. Never provide `MIGRATION_DATABASE_URL`, `LOCAL_OWNER_URL`, or cluster administrator credentials to the running application.

**Tenant isolation relies on application authorization.** The backend RLS policies deliberately permit all rows for the runtime role (`USING (true) WITH CHECK (true)`); they do not enforce tenant separation. Explicit owner predicates, authorization checks and composite foreign keys provide that separation. Do not give this role to end users or blindly enable FORCE RLS.

Back up PostgreSQL and configure point-in-time restore and retention with your host. Test recovery of database and private objects together. Migrating providers requires changing standard PostgreSQL/S3 configuration, not application APIs.

## Static and API deployment

Two arrangements are supported; no hosting provider or backend destination is selected:

1. **Combined Node service:** run `npm run build`, initialize the database as above, then `npm start`. Node serves the allowlisted frontend and `/v1/*` API together at one origin.
2. **Static host plus Node backend:** publish only `public-build/` after `npm run build`. Configure that host's reverse proxy to forward same-origin `/v1/*` requests to your explicitly chosen backend URL, preserving methods, bodies and cookies. `API_BASE` stays empty. The checked-in `vercel.json` supplies static build and security-header settings only; it does **not** connect an API. Static hosting alone cannot provide authentication or workspace persistence.

The obsolete Render destination remains removed. Apply equivalent CSP, anti-framing, nosniff, no-referrer, and permissions headers from `vercel.json` on other static hosts. Apply HTTPS redirects and HSTS at the edge. Do not cache `/v1/*` responses. Protect the backend from direct requests that bypass trusted proxy/IP controls.

The backend health endpoints are `/health` (process) and `/ready` (PostgreSQL/Redis). Readiness does not certify storage credentials, bucket privacy, or email delivery. Verify those with a real upload/download/delete and verification/recovery mail before rollout.

## Background maintenance and deletion

The running backend performs maintenance every 30 seconds, with PostgreSQL row locks / SKIP LOCKED for multiple instances. Keep at least one instance running; maintenance will pause on hosts that sleep all backend instances.

Deleting a resource/account removes its accessible records transactionally and enqueues object keys through a database trigger. Storage failures do not expose the resource again. The worker retries failed deletions every five minutes and does not discard failures. Successful deletion records remain for one hour of repeated checks to catch delayed provider writes. It removes all exact-key object versions. Stale incomplete uploads older than one hour are queued for cleanup. Account deletion cascades documents, revisions, links, resume state, device trust, challenges, codes, notification rows, and security history. A pre-existing admin audit log becomes anonymised through nullable foreign keys.

Account deletion is therefore immediate for application access and eventually consistent for object removal. Monitor queue age/count and retry attempts in `object_deletions` and `notification_outbox`; alert on sustained growth. Never include object keys, encrypted messages, recipients, tokens, or credentials in routine monitoring output. Object retention locks, missing delete-version permissions, and persistent provider outages require operator repair.

The worker purges expired sessions, old email tokens, expired device challenges, expired notification bodies, and security events past retention. Successful uploads cannot be garbage-collected while their locked upload transaction is in progress. As with other distributed storage systems, a storage request whose outcome is unknown after a network failure requires reconciliation; see the audit's residual risks.

## Dependency changes

Runtime additions: `@aws-sdk/client-s3`, `@fastify/multipart`, `file-type`, and `yauzl`.
Development additions: `@types/yauzl`, `jsdom`, and `prettier`.
The existing Fastify, PostgreSQL, Redis, Argon2id, WebAuthn, Zod and TypeScript dependencies remain. The engine requirement is Node 24 or newer; validation ran on Node 24.18.0. Exact installed versions are recorded in the lockfile.

## Additive migrations delivered

- `006_workspace.sql`: native documents/revisions, private resource metadata, owner-constrained attachments, resume state, and durable object deletion trigger/outbox.
- `007_devices_notifications.sql`: trusted devices, approval/recovery challenges and codes, security events, encrypted notification outbox, and deletable/anonymised admin audit ownership.
- `008_auth_race_guards.sql`: credential-generation binding for sessions/challenges and intended-email binding for one-time tokens.

Migrations 001–005 are unchanged. Apply the new migrations before starting the new backend. The application and migration runner do not use Neon-specific APIs.


## Brevo signup OTP and password recovery

The backend can send directly through Brevo using `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` (an active Brevo sender), and optional `BREVO_SENDER_NAME` (defaults to Chix). Set `EMAIL_REQUIRED=true` for production. Direct delivery uses Brevo's `api-key` header, `sender`, recipient array, and `textContent`, following [Brevo's transactional email API](https://developers.brevo.com/reference/send-transac-email). The existing custom adapter option remains supported through `EMAIL_DELIVERY_URL` and `EMAIL_DELIVERY_TOKEN`; its JSON contract is `{to, subject, body}`. Direct Brevo takes precedence when fully configured. Keep all keys on the backend.

Apply migration `016_signup_otp.sql` before starting the updated server. It allows absent country values and invalidates old verification links without deleting users. Pending users enter their email and choose **Send a new code**. Signup OTPs expire after 10 minutes by default (`TOKEN_VERIFY_EMAIL_MINUTES`, maximum 30), are bound to a single account and issuance, allow five attempts, and are consumed transactionally. Resending invalidates the previous issuance. Only successful OTP verification completes signup and issues the initial session. Password reset never bypasses pending signup verification.

The mail worker sends the encrypted outbox and retries delivery failures. A queued response does not prove inbox delivery. Password recovery sends a one-use link to the configured `WEBAUTHN_ORIGIN`; production must use the externally accessible HTTPS origin. Resetting a password revokes existing sessions and device trust; normal device approval remains required on subsequent sign-in.

## Passwordless sign-in

Apply `017_passwordless_auth.sql` before starting this version. It adds Google identity links and login codes without deleting accounts or existing password/passkey credentials. Email-code sign-in requires working email delivery; codes expire after 10 minutes, permit five guesses, and are replaced on resend. Sensitive-action codes are bound to the requesting session.

Google is optional. Configure both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` for the backend, and register the exact `${WEBAUTHN_ORIGIN}/v1/auth/google/callback` URL in the Google web client. The frontend hides Google sign-in when either value is absent. New Google users complete their profile; matching existing email accounts must prove mailbox access with an emailed code before linking. Keep callback paths routed to the API under the same public origin.

Local automated tests mock Google token exchange and verification; they do not establish live Google configuration or inbox delivery.

## Scoped authentication proofs

Apply `018_scoped_login_codes.sql` after migration 017 and before starting the updated backend, using the production setup procedure above. Stop older backend instances during this migration: their login-code writes assume the former primary key. The migration preserves accounts, passwords, passkeys, and existing challenges, scopes login and session reauthentication challenges separately, adds account-wide OTP budgets, and binds existing email links to the current credential epoch.

Resending replaces only the requesting flow's challenge. Login and reauthentication share an account-wide five-failure budget and delivery limits. Passwordless account settings accept recent session proof, while existing password confirmation remains available. Requesting an email change leaves the current email and session active until confirmation.

Password reset cancels pending recovery-address changes and invalidates their links while preserving an already verified recovery address. Newly generated recovery codes use `RECOVERY_CODE_DAYS`; existing codes retain their stored expiry, which redemption now enforces.
