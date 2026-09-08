# Chalkline

Server-first account API: Apple-style registration fields, Argon2id passwords, httpOnly sessions, rate limits, forgot-password tokens, and WebAuthn passkeys.

This is an **API**, not a website. There is no HTML UI in this pass.

This implementation **mitigates** credential stuffing (rate limits + lockout), password-dump reuse (Argon2id), session theft via `localStorage` (httpOnly cookies), mass assignment on profile update (allowlisted fields), and SQL injection (parameterized queries) **assuming** you configure Postgres, Redis (production), TLS, and email as below. It does **not** give you SMS verification, CAPTCHA, production email, or a pentest.

---

## A. What is in application code

- `POST /v1/auth/register` — first/last name, country, DOB, email, password, username, phone (E.164), address, marketing consents
- `POST /v1/auth/login` / `logout`
- `GET|PATCH /v1/me` — ownership via session; PATCH cannot set `role` / `is_admin`
- Email verify + password reset token consume (tokens hashed at rest)
- Passkey register (must already be signed in) + passkey login
- Helmet security headers
- Generic 500s to clients; details only in logs (cookies redacted)

## B. What you must configure (code cannot do this)

| Need | Why |
|---|---|
| Docker Desktop (or local Postgres + Redis) | Database and rate-limit store |
| `SESSION_SECRET` | Session cookie integrity is not enough; we store session hashes in DB. Secret is still required by config for future signed values — generate with `openssl rand -hex 32` |
| Redis in production | In-memory limits do not work across multiple Node processes |
| Email (Postmark, SES, Resend) | Real verify/reset mail. Dev writes `mail/dev-outbox.txt` |
| HTTPS + domain | Passkeys in production; `COOKIE_SECURE=true` |
| `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN` | Must match the site users open |
| SMS provider | Phone is **stored**, not verified, until you add Twilio (or similar) |
| CAPTCHA keys | Not wired yet |
| Billing caps | On SMS/email/host accounts in their dashboards |
| 2FA on GitHub, domain, host, email | Protects *your* admin accounts |

## C. Local setup

1. Install Docker Desktop and start it.
2. From this directory:

```bash
cp .env.example .env
openssl rand -hex 32   # paste into SESSION_SECRET in .env
npm install
docker compose up -d
npm test
npm run dev
```

3. Postgres runs `sql/001_init.sql` **only on first empty volume**. If you change SQL after the first start: `docker compose down -v && docker compose up -d`.
4. `curl -s http://localhost:3000/health`

Register (JSON, not a form):

```bash
curl -s -c cookies.txt -H 'Content-Type: application/json' -d '{
  "firstName": "Ada",
  "lastName": "Lovelace",
  "country": "ZA",
  "dateOfBirth": "1990-01-15",
  "email": "ada@example.com",
  "password": "correct horse battery",
  "confirmPassword": "correct horse battery",
  "username": "ada.l",
  "phone": "+27821234567",
  "address": {
    "line1": "1 Loop St",
    "city": "Cape Town",
    "postalCode": "8001",
    "country": "ZA"
  },
  "marketingAnnouncements": false,
  "marketingApps": false
}' http://localhost:3000/v1/auth/register
```

Dev verification token: `mail/dev-outbox.txt`.

Passkeys: call register options **while logged in**, then use the browser WebAuthn API. `localhost` works over HTTP; a real domain needs HTTPS.

### Headers (what Helmet set)

| Header | Role |
|---|---|
| Content-Security-Policy | Limits where scripts/frames can load if you later add HTML |
| X-Frame-Options / frame-ancestors | Reduces clickjacking |
| X-Content-Type-Options | `nosniff` |
| Strict-Transport-Security | Only in `NODE_ENV=production` |

HTTPS redirect is **your host/reverse proxy** (Caddy, nginx, Cloudflare), not this Node process.

### Row-level security

RLS is **enabled** on tables. The Docker user `chalkline` **owns** the tables, so it **bypasses** RLS. App-level `WHERE user_id = $1` is what actually isolates users today. To make RLS real: create a non-owner role, `FORCE ROW LEVEL SECURITY`, and `SET LOCAL app.user_id` per request. Ask for that pass when you want it.

### Rate limits

| Route family | Limit |
|---|---|
| Global | 120 / minute / IP |
| Login | 5 / 15 min / IP+email |
| Signup | 5 / hour / IP |
| Password reset request | 3 / hour / IP |
| Passkeys | 10 / minute |

Production **fails closed** if Redis is missing. Local without Redis uses memory and logs that this is not multi-process safe.

---

## Remaining attack surface

- No CAPTCHA on signup
- Phone not verified (SIM-swap recovery would be unsafe if you treated it as proof)
- Passkey challenges for registration live in process memory (use Redis before multiple app servers)
- No CSRF tokens yet (`SameSite=Lax` cookies; add CSRF if you add a browser form on another site)
- No object storage / file uploads
- No pentest

---

## Checklists

### Implementation
- [x] Code for register/login/session/reset/passkeys
- [ ] Email provider in production
- [ ] Redis in production
- [ ] Secrets in `.env` (not git)
- [x] Database schema in `sql/001_init.sql`
- [x] Password hash test
- [ ] Negative tests for IDOR / rate limit (next pass)
- [ ] Confirm 429 on burst login
- [ ] Confirm `/v1/me` 401 without cookie
- [ ] Confirm production does not send stack traces

### You do
1. Generate `SESSION_SECRET`
2. `docker compose up -d`
3. Pick email provider before any real user
4. Set domain + TLS + WebAuthn RP ID before passkeys in prod
5. Turn on 2FA on hosting/DNS/email
