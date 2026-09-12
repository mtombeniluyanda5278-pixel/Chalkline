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

## Install, configure, migrate, build, test, run

Use Node 24 LTS and npm. `package.json` and `package-lock.json` now belong in source control.

```sh
npm ci
cp .env.example .env
```

Fill the blank variables in `.env` using the guide in [Deployment](docs/DEPLOYMENT.md). The example deliberately contains names and blank values only. Do not overwrite an existing `.env`.

For a **new empty database**:

```sh
npm run migrate
npm run build
npm run test:unit
npm run test:integration
npm run dev
```

For an **existing database** that already has migrations 001–005 applied but no migration ledger, first verify that history, back up the database, then run:

```sh
npm run migrate -- --baseline=005
```

Baseline records existing migrations without replaying them and applies newer migrations. Do not use it on an empty or partly migrated database. Never edit old numbered migrations. Migration checksums and an advisory lock prevent changed/repeated/concurrent applications.

`npm run test:integration` starts isolated Docker containers with generated credentials, applies all migrations, tests the migration ledger twice, runs the existing and new API tests, and removes its containers. It does not use your application database. Docker/Colima must be running and able to pull the pinned test images.

`npm test` runs the API tests using `.env.test`. That configuration **must use a dedicated disposable database and Redis database 15**; tests clear Redis counters and delete their own generated users. Use the isolated runner when in doubt.

In a second terminal:

```sh
npm run preview
```

Open `http://localhost:8080`. Set `WEBAUTHN_ORIGIN` to that exact origin and `WEBAUTHN_RP_ID` to `localhost` for this local flow. The preview server proxies `/v1/*` to port 3000 and serves only explicitly public files. `npm run dev` runs the backend; it does not serve the frontend.

Production backend:

```sh
npm run build
npm start
```

Production static output is **`public-build/` only**. Do not publish the repository root or backend `dist/`. The Vercel configuration preserves the current API rewrite and publishes only the explicit public allowlist. Other static hosts can serve the same directory and reverse-proxy `/v1/*`.

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

## Autosave behavior

A browser serializes its own saves. PostgreSQL accepts a change only if its revision matches; competing tabs receive HTTP 409. A failed draft remains on screen. Retry resends with the same revision, so an ambiguous network failure becomes a conflict instead of an overwrite. Save-as-copy preserves a competing draft in a new document. Download draft exports unsaved content for recovery.

Navigation waits for saving. If saving fails, leaving requires an explicit discard confirmation. Browser unload prompts are best effort: forced process termination, device failure, or closing a mobile browser can lose edits that have not reached the server. This is not an offline editor, and no browser storage is treated as the source of truth.
