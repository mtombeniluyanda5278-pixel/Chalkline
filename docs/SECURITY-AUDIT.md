> **Superseded implementation state:** This audit describes the first pass. The second pass is unfinished and has failing tests. See [current handoff](HARDENING-PASS-2.md). Do not use earlier findings as validation of the current branch.

# Chalkline security audit

Review dates: 11–12 September 2026. Scope: the completed local implementation, source/configuration review, additive SQL migrations, dependency audit, frontend DOM/autosave tests, and isolated PostgreSQL/Redis/S3 integration tests. This is an implementation audit, not an independent penetration test or a claim that a live deployment is secure.

The review covered tracked application source, tests, schema and deployment files, new modules, dependency manifests, public build output, and local archive entry names. Generated/vendor internals were assessed through the dependency audit rather than reviewed line by line. Production credentials were not printed, used for testing, or placed in artifacts. Existing archives contain `.env.test` entries; they remain ignored and excluded from the public build. Do not distribute those old archives without separately reviewing/redacting their contents.

## Critical

No confirmed unresolved Critical finding was established within the tested scope. No claim is made about whether a previous live deployment exposed files or credentials; live hosting and access logs were not inspected.

## High — fixed

### H1. Repository root selected for static publication

- **Area:** deployment, secrets, information exposure.
- **Exploit:** a static deployment built from `.` could publish application source or other unintended files. The exact impact depends on which files the host included.
- **Fix:** an explicit five-file static allowlist builds `public-build/`; Vercel publishes only that directory. Environment files, backend output/source, dependencies, test artifacts and archives are excluded. Package manifests and the blank environment example are no longer ignored from source control.
- **Verification:** built output inventory and source/configuration inspection; public output contains only index.html, styles.css, app.js, workspace.js, and autosave.js.

### H2. Password login lacked unknown-device approval

- **Area:** authentication, trusted devices, recovery.
- **Exploit:** possession of a password immediately granted a full session from a new browser.
- **Fix:** password-only new browsers receive a pending cookie bound to a hashed 256-bit challenge and credential generation. Trusted, recently authenticated devices approve the human number; approval is owner-scoped, expiring, rate-limited and single-use. User-Agent never grants trust. Registration bootstraps trust; verified passkeys require user verification. Recovery codes are high-entropy, stored hashed, and consumed atomically. Verified-email recovery requires the requesting browser cookie and successful password authentication.
- **Verification:** API tests confirm no session is issued before approval, pending cookies cannot read `/v1/me`, wrong-number/cross-user/expired/replayed requests fail, recovery consumes codes and revokes previous sessions.

### H3. Reset and verification token races

- **Area:** password reset, email verification/change, sessions.
- **Exploit:** separate token consumption and password update could consume a token without completing the change. A token issued/delivered concurrently with email changes could act on the wrong email identity. A login already verifying old credentials could finish after credentials were changed.
- **Fix:** password reset runs token consumption, password change, session/trust/recovery revocation and event recording in one transaction. Tokens are bound to their intended email; issuance checks the expected recipient under a user lock. Verification checks that target against the current email. Sessions/challenges capture `auth_epoch`; credential changes invalidate older generations. Old reset tokens are invalidated during email/password changes.
- **Verification:** replay, stale recipient, changed email, session generation and reset revocation regression tests. Concurrency paths reviewed against PostgreSQL row locking. A database deadlock/transaction failure fails closed and may require retry; it does not commit a partial transaction.

### H4. Versioned object storage deletion and partial failures

- **Area:** privacy, account deletion, resources.
- **Exploit:** deleting only file metadata leaks private objects; a plain S3 DeleteObject on a versioned bucket can leave historical content. A provider outage can permanently interrupt cleanup without a durable record.
- **Fix:** a PostgreSQL deletion trigger queues exact generated keys, including on account cascade. Worker deletion enumerates and removes exact-key versions and delete markers, checks no neighbouring keys, and retries failures without discarding them. Successful tombstones are rechecked for one hour to catch delayed writes following ambiguous upload failures. In-progress uploads hold a resource lock; stale incomplete uploads are later reconciled.
- **Verification:** private file lifecycle/account deletion integration tests, versioned S3 bucket with multiple object versions, and simulated deletion outage/retry tests. Actual Backblaze permissions and lifecycle policies require a staging check.

### H5. Concurrent removal of the last passwordless sign-in method

- **Area:** passkeys, account lockout.
- **Exploit:** two requests could each observe more than one passkey and together delete the final two credentials on a passwordless account.
- **Fix:** lock the account row while checking remaining methods and deleting the owner-scoped credential. Removal advances the credential generation, revokes old sessions and rotates the current session; an in-flight assertion from the removed credential cannot create a valid older-generation session.
- **Verification:** TypeScript build and transaction/authorization review. Actual hardware authenticator enrollment/removal remains a live browser verification item; existing WebAuthn options/challenge/rejection tests ran.

## Medium — fixed or mitigated

### M1. Concurrent document writes and destructive actions

- **Area:** notes, lesson plans, templates, autosave, data loss.
- **Exploit:** competing tabs overwrite newer work, or deletion acts on an unseen newer revision.
- **Fix:** PostgreSQL revision checks and row locks permit one winner; prior content is retained for the last 50 revisions. A serialized browser writer preserves failed/conflicting drafts, freezes automatic conflict retries, and offers explicit retry, download and save-as-copy. Delete supplies the revision actually held by the editor. Navigation waits for saves and requires confirmation to discard failed work.
- **Verification:** simultaneous API writes produce one 200 and one 409; revision history contains the previous content. Unit tests cover in-flight edits, conflict freeze, retry after failure, debounce, cancellation and exact cursor/scroll restoration. Programmatic focus events are suppressed during initial state restoration so they cannot overwrite the saved position. Forced browser termination remains a residual risk.

### M2. CSRF and static-origin headers

- **Area:** web security, cookies, browser uploads.
- **Exploit:** a hostile origin submits an authenticated mutation or embeds the application; untrusted content runs with app privileges.
- **Fix:** exact Origin validation and Fetch Metadata rejection on mutations, Strict/HttpOnly session and trust cookies, Secure required in production, no permissive CORS, same-origin `/v1/*`, API no-store, static CSP with no inline scripts/object/frame execution, anti-framing, nosniff and no-referrer headers. Uploaded documents never execute in the app origin. No arbitrary redirects are accepted.
- **Verification:** foreign-Origin/Fetch-Metadata tests, header/configuration review, source search for HTML injection/eval/localStorage. Frontend builds nodes with textContent. Browser request headers and static host headers still need verification after deployment.

### M3. Upload spoofing, archive abuse, and ownership

- **Area:** upload, preview/download, IDOR, lesson attachments.
- **Exploit:** users upload executable content under a safe extension, exhaust memory/storage, traverse object paths, or request another account's file.
- **Fix:** format allowlist, independent file signatures, UTF-8 text validation, Office ZIP path/entry/expanded-size checks, rejection of macros/embedded executables/active HTML/SVG archive entries, byte and per-user quotas, Redis upload/download limits. Generated UUID object keys never include filenames. MIME-safe forced downloads and text/raster previews. Every operation filters by owner; composite FKs enforce same-owner lesson attachments.
- **Verification:** active-format/spoof/invalid-archive/unsafe-name tests, oversized upload test, upload rate bucket test, cross-user metadata/download/preview checks, owner attachment tests, real S3-compatible upload/download/delete lifecycle.
- **Limit:** signature validation is not malware scanning. PDF/Office files may contain active features that act when opened externally; the app never previews them as executable same-origin content. Parser/image-decoder vulnerabilities and load limits require ongoing patching/monitoring.

### M4. Provider-coupled email and security observability

- **Area:** notifications, auth availability, privacy.
- **Exploit:** a provider outage prevents auth actions or produces inconsistent reset responses; raw token logs expose account recovery secrets.
- **Fix:** provider-independent delivery interface, authenticated-encrypted notification bodies at rest, bounded retention, retries and delivery timeout. No raw tokens in API responses/logs. Production fails at startup when email is marked required but unconfigured. Security history records important auth/device/session/passkey/account actions without credentials or tokens. Account email changes also notify the previous address.
- **Verification:** encryption round-trip/tamper test, worker delivery/queue execution in integration tests, source/log review, production configuration guards reviewed. No real email provider or deliverability test was performed.

### M5. Broad proxy trust and weak operational isolation

- **Area:** rate limiting, deployment, privacy.
- **Exploit:** trusting arbitrary forwarded IPs allows rate-limit bypass; static/API caches expose authenticated responses.
- **Fix:** production rejects blanket `TRUST_PROXY=true`; explicit proxy CIDRs/IPs are required if proxy trust is enabled. Authenticated API responses have no-store. Redis remains fail-closed; all new routes pass the global limiter plus sensitive-operation buckets.
- **Verification:** configuration and rate-limit path review, integration limit test. The correct production proxy chain is an operator setup requirement.

## Low — fixed

### L1. Sign-out reported success after a failed server request

- **Area:** session UX.
- **Exploit:** the user believes a shared-device session ended when the cookie/session is still valid.
- **Fix:** failed sign-out preserves state and clearly requests retry; success is shown only after server confirmation.
- **Verification:** frontend handler review and build/DOM regression checks.

### L2. Date timezone shifts and inaccessible fragment navigation

- **Area:** schedule correctness and accessibility.
- **Exploit/failure:** PostgreSQL dates serialized through local-midnight Date objects can display the previous day; the skip link could be interpreted as an app route.
- **Fix:** PostgreSQL date-only values remain ISO date strings. Skip navigation focuses main without changing routes. Fields remain labelled; native dialogs trap focus; reduced-motion disables animation.
- **Verification:** date round-trip API test, DOM test/source review, reduced-motion and responsive CSS inspection. No screenshot-based visual QA or screen-reader session was performed.

## Informational and residual risks

- **Live infrastructure is not certified.** Neon TLS/roles/backups, Redis TLS and limits, bucket privacy/version-delete permissions, reverse-proxy headers, email adapter/deliverability and a real passkey ceremony need staging verification. Nothing was published or migrated against a production database.
- **Legacy recovery must be prepared.** An unverified legacy account with no active session, passkey or saved recovery codes has no secure self-service recovery evidence. Enable email and onboard existing users' recovery options before rollout; operator-assisted identity verification is needed for exceptions. Password-only approval is deliberately not used as a bypass.
- **Database tenant isolation remains application-enforced.** Existing RLS tables have no application policies and owner connections bypass RLS. New queries use owner predicates and composite constraints, with negative tests. A restricted-role/RLS redesign requires a separate tested rollout; do not misrepresent the current arrangement as database-enforced per-user isolation.
- **Distributed side effects are eventually consistent.** Object deletion retries and one-hour rechecks handle ordinary outages and delayed requests. Provider retention locks, very late writes, persistent outages and missing permissions require operational reconciliation. Email delivery is at-least-once, and the outbox expires after a day. Monitor both queues.
- **No offline/crash-proof editing.** The server is the source of truth. Pending edits survive ordinary API errors in the open editor, but device failure/forced closure can lose edits not yet acknowledged. Browser unload prompts are best effort. PDF/Office page bookmarks are manually recorded, not tracked inside external applications.
- **Abuse/load risk remains.** Uploads are buffered within configured limits, not streaming to a scanner. No antivirus/CDR pipeline, signup CAPTCHA, paid-plan quota enforcement, external penetration test, or load/stress test was added. Per-user quotas, Redis limits and allowlists reduce exposure but do not eliminate distributed abuse or parser zero-days.
- **Logs and retention.** Security history stores owner-scoped event names/IPs for the configured retention window. Notification recipients are necessarily stored in plaintext for delivery while bodies are encrypted. Device records remain until account deletion. Restrict database/log access and align retention with your privacy policy. Account deletion intentionally removes its security-event history, including the deletion event written immediately before cascade.
- **Dependency audit is point-in-time.** npm reported zero known advisories for the installed dependency tree at audit time. This does not prove the dependencies have no vulnerabilities. The isolated S3 test container is test-only and is not a production hosting recommendation.

## Verification record

- `npm run build`: passed (TypeScript compilation and explicit static bundle).
- `npm run test:integration`: passed, **35 tests**, zero failures and zero skipped. The runner applied migrations 001–008 to isolated PostgreSQL 16, verified a second migration run, used Redis 7 and a versioned S3-compatible test bucket, and removed its test containers.
- `npm run test:unit`: passed, **6 tests**, zero failures. Includes the final regression for saved cursor/selection/scroll restoration and preserving the editor after sign-out preparation.
- `npm run format:check`: passed. No ESLint configuration exists; this is a Prettier check, not semantic linting.
- `npm audit --json`: **zero known vulnerabilities** across all reported severity categories in the installed tree.
- `git diff --check`: passed.
- Public bundle inventory: the five intended frontend files only.
- Targeted credential-pattern scan of tracked/new nonignored source: no matches. This is a heuristic scan, not proof that no secret has ever existed in repository history.

One intermediate integration run stopped before migration because its readiness probe hit PostgreSQL's temporary bootstrap server. The runner now probes the host TCP connection; the subsequent 35-test run passed. The initial storage test image name was unavailable; the runner uses an explicitly pinned available test image. No production database was used.

Tests live in `src/workspace.test.ts`, the existing auth/password/WebAuthn tests, and `tests/`. Actual provider credentials, a deployed static host, browser hardware authentication, screenshot-based layout checks, screen-reader checks and load testing were not exercised.

The review used [OWASP upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), and [Backblaze version-aware deletion semantics](https://www.backblaze.com/apidocs/s3-delete-object) to check implementation boundaries; this is not a formal OWASP certification.
