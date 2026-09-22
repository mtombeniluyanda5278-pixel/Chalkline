# Administrator operations

These procedures describe the current implementation. The broader hardening pass remains unfinished; this is not deployment approval.

## Bootstrap an administrator

There is no public promotion endpoint. An operator with authorised database access must first verify the intended person's identity and exact account UUID through the existing support process. Register and verify the account normally. Configure a passkey before enabling mandatory passkey access.

Run from the repository with the intended backend environment securely configured:

```sh
node --import tsx scripts/bootstrap-admin.ts --apply ACCOUNT_UUID 'Verified owner bootstrap request'
```

The command uses the same configuration loader as the backend, including `.env` unless `DOTENV_CONFIG_PATH` specifies another file. Verify the target database before running; do not paste connection strings or credentials into the command. The script requires the development `tsx` dependency, so run it from an operator checkout with dependencies installed.

The transaction locks the account, requires completed registration and a verified primary email, rejects suspension, checks for an enrolled passkey when `ADMIN_REQUIRE_PASSKEY=true`, grants the role, increments the authentication generation, revokes existing sessions and records `admin_bootstrap` with the operational reason. Repeating the command for an existing administrator makes no changes. The operator must sign in again. No promotion was performed as part of implementing this command.

## Authentication and privacy

`ADMIN_REQUIRE_PASSKEY` defaults to `false`. Before setting it to `true`, enroll and test a passkey for each intended administrator and retain authorised database operator access for recovery. A passkey login or passkey step-up is required when the setting is enabled. Password step-up alone cannot satisfy that policy.

Every admin API requires authentication within five minutes. `ADMIN_IDLE_MAX_MINUTES` defaults to 30 and accepts 1–60; it applies to existing admin sessions as well as new ones, including ordinary workspace requests. Expired admin sessions are omitted from active-session listings. Sensitive writes revalidate the admin role, session and recent authentication inside their transaction.

The user list returns first name, surname initial, masked email and account status. `POST /v1/admin/users/:id/contact` requires a 10–300 character reason and records `contact_reveal` with the target account before returning full contact fields. Keep reasons free of private document content and credentials. Administrator status grants no access to another teacher's notes, lessons or files.

`POST /v1/admin/users/:id/suspension` accepts `suspended` and a reason. Suspension changes are audited and revoke all target sessions; unsuspension does not revive old cookies. Self-suspension is rejected.

## Feedback and scan retries

Feedback requires an authenticated user. Unconsented diagnostic payloads are discarded, including unknown fields. Consented diagnostics must match the server allowlist; unknown fields are rejected. User-facing feedback responses omit diagnostics. Admin status updates are audited.

`GET /v1/admin/jobs` lists scan states and aggregate email/deletion states. `POST /v1/admin/jobs/:id/retry` retries only a dead scan whose resource is `scan_failed`; quarantined resources cannot be released by retrying. The action is audited. Shared Redis capacity limits scans across workers; when capacity is full, queued jobs are not claimed and attempts are not consumed.

Email and deletion retry controls, feature flag operations, and the full admin UI remain unfinished. Do not treat these API procedures as completion of those features.

## Filter accounts and send email

Administrators now have an **Admin** link in the top navigation. The account list supports configured subscription plan, age range, creation-date range (inclusive UTC dates), file storage used, file storage allowance, and document capacity used as a percentage. Storage amounts use MiB (1,048,576 bytes). Plan choices are read from `plans`; this does not enable billing or create paid subscriptions.

Leave the filters blank for all accounts. **Preview email and recipients** creates a 15-minute draft with a fixed list of up to 10,000 eligible account IDs, encrypted message content and a masked recipient sample. **Send** requires explicit confirmation and recent administrator authentication, queues a separate email for each account and records an audit event. Retrying the same draft is idempotent. Previewing never sends or queues mail. Newly matching accounts are not added after preview; deleted, suspended, unverified or opted-out announcement recipients are skipped at queue time.

Service updates target active verified accounts with completed registration. Announcements additionally require `marketing_announcements`. Existing mail delivery configuration and the maintenance worker deliver queued emails; the local development fallback writes them to `mail/dev-outbox.txt` rather than sending real mail. Never use a service update to bypass announcement preferences.

Migration `023_admin_campaigns.sql` must be applied before using email previews. Local startup applies migrations automatically. No email campaign is sent during feature setup.

For an explicitly local account, `node scripts/bootstrap-local-admin.mjs --apply EMAIL` resolves the exact email in the isolated localhost database, applies local migrations, and delegates to the audited bootstrap command. It does not use the production database connection. Promotion revokes existing sessions; sign in again to see the Admin navigation. A local role grant does not grant access on a later deployment.
