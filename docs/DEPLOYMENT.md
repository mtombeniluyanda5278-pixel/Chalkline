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
- `UPLOAD_MAX_BYTES`: default 20 MiB, configurable up to 25 MiB.
- `STORAGE_USER_QUOTA_BYTES`: default 1 GiB per user, additionally capped at 5,000 resources per account.

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

Existing authentication tables enable RLS without application policies; the existing owner connection bypasses RLS. The new application uses explicit owner predicates, composite foreign keys, and validated constant query identifiers. It does not claim database-enforced tenant isolation. A non-owner application role needs narrowly scoped grants and deliberate RLS policies compatible with these queries before use; do not blindly switch roles or FORCE RLS without testing authentication.

Back up PostgreSQL and configure point-in-time restore and retention with your host. Test recovery of database and private objects together. Migrating providers requires changing standard PostgreSQL/S3 configuration, not application APIs.

## Static and API deployment

Build with `npm ci && npm run build`. Publish only `public-build/`. Start the backend with `npm start` after migrations. Keep the static host `/v1/*` rewrite and backend origin configuration aligned. `API_BASE` stays empty.

The checked-in Vercel rewrite retains the existing Render destination. If you move hosts, update the reverse proxy there rather than hardcoding a backend URL in JavaScript. Apply the equivalent CSP, anti-framing, nosniff, no-referrer, and permissions headers from `vercel.json` on other static hosts. Apply HTTPS redirects and HSTS at the edge. Do not cache `/v1/*` responses. Protect the backend from direct requests that bypass trusted proxy/IP controls.

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
