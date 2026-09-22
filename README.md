> **Work-in-progress checkpoint:** Chix hardening pass 2 is incomplete and not ready to deploy or claim review-ready. See [unfinished work and test results](docs/HARDENING-PASS-2.md).

# Chalkline

A portable teacher workspace: a static JavaScript frontend, Fastify / Node / TypeScript API, PostgreSQL, Redis, and private S3-compatible storage. Browser requests stay on the frontend origin through `/v1/*`.

## What is included

- Public homepage with accessible sharing and reduced-motion support.
- Dashboard, files, notes, lesson plans, reusable templates, schedule, account/security, and trusted devices.
- PostgreSQL resume state for document cursor/selection/scroll/active field and file reading bookmarks.
- Debounced autosave, serialized writes, optimistic revisions, the latest 50 prior versions, visible failures, draft download, and save-as-copy conflict recovery.
- Private file uploads with byte limits, per-user quotas, MIME/signature checks, Office archive inspection, owner-authorized downloads, text/image previews, and lesson attachments.
- Existing password, Argon2id, email verification, password reset, WebAuthn, session revocation, Redis limits, and recent-auth checks, extended with device approval and recovery.
- Provider-independent encrypted email outbox and security-event history.
- Durable object deletion queue, including exact-key object versions and delete markers.

PDF and Office content opens through forced download into the user's document reader. Chalkline remembers a manually saved page/description bookmark; it cannot observe the cursor or page inside an external application. Raster images and UTF-8 text can be viewed inside Chalkline. Native notes/lesson plans are editable application documents, separate from uploads.

## Local development

Use Node 24 LTS (`24.x`), npm, and Docker. After `npm ci`, the normal workflow is:

```sh
docker compose up -d
npm run dev
```

Open **http://localhost:3000**. Fastify serves both the frontend and `/v1/*`; no preview server is needed. Use this exact origin for local passkeys: WebAuthn requires a domain name, not the loopback IP address.

Signup and sign-in use a six-digit emailed code without requiring a password. Existing passwords and passkeys remain usable. Google sign-in is available when configured; new Google users complete their profile, while an existing email account requires an emailed code before linking Google. Codes expire after 10 minutes, allow five guesses, and can be resent from the verification screen. Country is no longer required.

For real local mail, configure `BREVO_API_KEY` and the verified `BREVO_SENDER_EMAIL` in `.env` or ignored `.local/email.env`, with optional `BREVO_SENDER_NAME`. Restart `npm run dev` after changing them. The local runner imports only these mail settings and the optional Google credentials from those files; generated local database credentials remain isolated. Tests always disable Brevo. Without configured delivery, development writes messages to private `mail/dev-outbox.txt`. Password recovery emails contain a one-use reset link.

Migration `016_signup_otp.sql` invalidates previous email verification links; pending users should select **Send a new code**. It preserves accounts and existing country values.

Migration `017_passwordless_auth.sql` adds Google identity links and hashed, single-use sign-in codes while preserving existing credentials. For optional Google sign-in, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the environment or ignored `.local/google.env`. Register `http://localhost:3000/v1/auth/google/callback` as the local web client’s redirect URI. Restart the development server after configuration changes. Automated tests use simulated Google responses and disable real email delivery.

Compose generates random credentials in ignored `.local/` files and uses separate `chix-local` volumes and loopback ports 55434/56380, preserving historical databases. `npm run dev` applies the migration ledger and provisions restricted `chalkline_app` before startup; `npm test` separately prepares `chalkline_test_app` and the test database. Runtime roles cannot create schema, grant privileges, bypass RLS, or connect to the other database. Local RLS policies permit the backend's existing owner-authorized queries; they do not implement per-user database identity. Keep `.local/` with its matching volumes; it contains private credentials. Do not delete volumes to troubleshoot setup.

Bootstrap reconciles existing runtime-role passwords with the generated `.local/credentials.json`, restores migration-owner schema access before migrations, then grants restricted runtime access and configures the migrated plans. `plans` is created by migration 010 and the unverified row by 012; no table is created outside migrations. Migration 015 retains its recorded name; the unused 014 identifier does not prevent ordered migration execution. The isolated integration runner repeats this bootstrap using a restricted runtime role and verifies recovery from deliberately stale passwords and revoked schema access.

Keep the migration-owner credentials paired with their existing volume. If those owner credentials no longer match, startup stops with a diagnostic: restore the matching `.local/credentials.json` backup. It never recreates a database or resets an unknown owner's password. Malformed or incomplete credential files also fail without regeneration or printing values. `postgres/pg_hba.conf` is a reference file; current Compose uses the official image's generated authentication configuration with SCRAM for host connections.

The local runner does not modify your real `.env`; it reads only the Brevo mail settings and Google credentials described above. Development registration CAPTCHA is explicitly disabled; local test CAPTCHA uses the mock provider. Production validation still forbids mock providers and requires configured CAPTCHA when registration protection is enabled.

```sh
npm test
npm run test:unit
npm run test:integration
npm run build
npm run format:check
```

`npm test` uses the dedicated generated local test database and Redis DB 15, without `.env.test` overrides. File-provider tests skip when local storage is absent. `npm run test:integration` provisions temporary PostgreSQL, Redis, and MinIO containers with generated credentials and tmpfs data, applies migrations, runs all API tests, and stops those containers; it does not remove persistent Docker volumes. Tests clean up their own users and test rate-limit keys, not whole databases. Neither test command uses your application `.env`.

For production configuration, use the blank names in `.env.example` and the existing deployment guide. Never overwrite an existing `.env`. Apply migrations with a privileged migration connection; runtime credentials should not own schema. Existing databases without a migration ledger still require an explicitly verified `--baseline=NNN`; local startup does not guess a baseline or replay old migrations.

Production backend:

```sh
npm run build
npm start
```

Production static output is **`public-build/` only**. Do not publish the repository root or backend `dist/`. The Vercel configuration publishes only the explicit public allowlist. Other static hosts can serve the same directory and must reverse-proxy `/v1/*`.

Additional checks:

```sh
npm run format:check
npm audit
```

There is no ESLint configuration; formatting is checked by Prettier. Tests do not certify a live provider deployment, browser authenticator, email deliverability, or load capacity.

## Project guide

- `app.js`: established authentication/account forms and route shell.
- `workspace.js`, `autosave.js`: workspace screens and autosave state machine.
- `src/documents.ts`: notes, lessons, templates, revisions, attachments, resume, dashboard.
- `src/resources.ts`, `src/fileValidation.ts`, `src/storage.ts`: resource authorization, uploads, validation, S3 abstraction.
- `src/devices.ts`, `src/security.ts`: trust, number matching, recovery, security events.
- `src/mail.ts`, `src/worker.ts`: encrypted notification queue, delivery adapter, retention, storage cleanup.
- `sql/006_workspace.sql`, `007_devices_notifications.sql`, `008_auth_race_guards.sql`: additive migrations.
- `scripts/`: migration runner, static build/preview, isolated integration runner.
- [Deployment and operations](docs/DEPLOYMENT.md).
- [Security audit and verification](docs/SECURITY-AUDIT.md).
- [Administrator bootstrap and operations](docs/ADMIN-OPERATIONS.md).

## Autosave behavior

A browser serializes its own saves. PostgreSQL accepts a change only if its revision matches; competing tabs receive HTTP 409. A failed draft remains on screen. Retry resends with the same revision, so an ambiguous network failure becomes a conflict instead of an overwrite. Save-as-copy preserves a competing draft in a new document. Download draft exports unsaved content for recovery.

Navigation waits for saving. If saving fails, leaving requires an explicit discard confirmation. Browser unload prompts are best effort: forced process termination, device failure, or closing a mobile browser can lose edits that have not reached the server. This is not an offline editor, and no browser storage is treated as the source of truth.

### Complete validation (disposable state)

```sh
npm run build
npm run test:unit
npm run test:integration
npm run build
```

`test:integration` creates uniquely named disposable PostgreSQL, Redis and MinIO containers using temporary storage, verifies bootstrap and production setup, then runs **`npm test`** with isolated runtime credentials and storage enabled. It stops only its own containers and removes its temporary credential files. Docker must be running. No existing databases or volumes are reset.

Ordinary `npm test` runs the backend `src/**/*.test.ts` suite against the separate local test database, excludes the separate frontend suite (`npm run test:unit`), and may skip storage tests when storage is unconfigured. Use `test:integration` for state-changing validation without touching persistent local test data. Its bootstrap checks exercise both dev-first and test-first provisioning, connection denial in both directions after each startup, repeated setup, stale passwords, runtime schema access, non-superuser migration-owner schema access, restricted grants/ledger denial, and configured quota values for both plans. It also exercises the production setup procedure against disposable PostgreSQL.

The final build refreshes ignored `public-build/` from the current frontend source, including removal of IP displays. Production requires the explicit [operator setup command and hosting arrangement](docs/DEPLOYMENT.md); static hosting configuration alone does not connect an API.
