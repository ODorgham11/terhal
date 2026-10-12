# Limousine Transportation Platform — Infrastructure Architecture

> **Companion to `master-doc.md`.** That document covers business logic and
> the data model; this one covers **how the cloud services are wired
> together**, how code gets from a laptop to production, and what happens
> when a piece fails.
>
> **Last updated: 2026-10-02**, to cover the `feature/auth` branch (auth,
> invitations, Resend email, Postgres rate limiting). Sections are
> marked **LIVE** (built and running), **PLANNED** (decided, not built yet),
> or **OPEN** (undecided).

---

## 0. Current State at a Glance

| Piece | Status | Where |
|---|---|---|
| Frontend (Next.js 16) | **LIVE** — home page still empty; auth pages (sign-up/in, verify, password reset, staff/admin invitations, admin sign-in) arrive with `feature/auth` | Vercel project `terhal-frontend` → `https://terhal-frontend.vercel.app` |
| Backend (Hono) | **LIVE** — `/health` and `/health/process`; `/auth/*`, `/staff/*`, `/admin/*` arrive with `feature/auth` | Vercel project `terhal-backend` → `https://terhal-backend-fawn.vercel.app` |
| Database (Postgres) | **LIVE** — 6 migrations applied; 3 more (`rate_limit`, `invitations`, `reset`) apply on merge of `feature/auth` | Neon project `Terhal`, AWS Frankfurt, branches `production` + `development` |
| CI (lint / typecheck / build) | **LIVE** | GitHub Actions `.github/workflows/ci.yml` |
| Migrations | **LIVE** | GitHub Actions `.github/workflows/migrate.yml` |
| Branch protection on `main` | **LIVE** | GitHub ruleset `protect-main` |
| Email (Resend) | **IN CODE** on `feature/auth` — needs `RESEND_KEY`/`RESEND_EMAIL` on Vercel | see Section 3.8 |
| Rate limiting | **IN CODE** on `feature/auth` — Postgres `RateLimit` table, no extra service | see Section 3.9 |
| Cloudflare R2, Turnstile, Google Places, Upstash QStash, WhatsApp Cloud API, Cashier, Sentry | **PLANNED** — not integrated yet (WhatsApp is a stub that throws in production) | see Section 3 |

Repository: `github.com/ODorgham11/terhal` (moved from `ammarsarhan/terhal`;
GitHub redirects the old URL, but update local remotes with
`git remote set-url origin https://github.com/ODorgham11/terhal.git`).

All server-side compute runs in **Vercel region `fra1` (Frankfurt)**, the
same AWS region as the Neon database (`eu-central-1`). Vercel *builds* run in
`iad1` (Washington) — that's normal and doesn't affect runtime latency.

---

## 1. Topology

```
                         Browser (customers + staff)
                                   │ HTTPS
              ┌────────────────────┴─────────────────────┐
              ▼                                          ▼
   ┌──────────────────────┐                ┌──────────────────────────┐
   │ Vercel: terhal-frontend│  API calls   │ Vercel: terhal-backend    │
   │ Next.js 16 (SSR)       │─────────────▶│ Hono app as ONE Node.js   │
   │ root dir: frontend/    │  (CORS:      │ function: api/index.ts    │
   │ region: fra1           │  FRONTEND_URL)│ root dir: backend/, fra1 │
   └──────────────────────┘                └────────────┬─────────────┘
                                                        │ TLS, pooled
                                                        ▼
                                          ┌──────────────────────────┐
                                          │ Neon Postgres (Frankfurt)│
                                          │ branch production  ◀─ Prod│
                                          │ branch development ◀─ Preview│
                                          └──────────────────────────┘

   GitHub (ODorgham11/terhal)
     ├─ PR opened  → ci.yml runs (Frontend + Backend checks)
     │              + Vercel builds Preview deployments of both projects
     ├─ merge to main (only via PR, checks must pass)
     │              → Vercel auto-deploys Production of both projects
     └─ migrations  → migrate.yml applies them to Neon production
```

**Two separate Vercel projects, one repo.** Both projects are connected to
the same GitHub repo and differ only by *Root Directory* (`frontend/` vs
`backend/`). A push to `main` redeploys both; a PR gets a Preview deployment
of both.

The browser only talks to the two Vercel domains. It never talks to the
database directly. (Planned exceptions: Google Places autocomplete and the
Turnstile widget — see Section 3.)

---

## 2. Live Services

### 2.1 Vercel — backend (`terhal-backend`) — LIVE

**How the Hono app runs on Vercel.** Vercel has no long-running server; it
invokes a function per request. The backend is split so the same app runs
both locally and on Vercel:

| File | Role |
|---|---|
| `backend/src/app.ts` | Defines the Hono app (middleware, routes, error handler). No side effects, no port. |
| `backend/src/index.ts` | **Local dev only.** Wraps `app` with `serve()` from `@hono/node-server` on port 8080. Vercel never runs this. |
| `backend/api/index.ts` | **Vercel entry point.** `export default getRequestListener(app.fetch)` from `@hono/node-server`. |
| `backend/vercel.json` | Rewrites every path (`/(.*)`) to `/api`, so routes stay `/health`, `/auth/...` with no `/api` prefix. The original path is preserved when the function receives the request. |
| `backend/public/.gitkeep` | Empty placeholder. Vercel's "Other" preset fails the build without a `public/` output folder. |

**Project settings (as configured):**
- Framework Preset: **Other**
- Root Directory: `backend`
- Install Command (override): `npm install` — forced because a leftover
  `backend/pnpm-workspace.yaml` could make Vercel pick pnpm
- Build Command: effectively `npm run build` → `tsc`, which doubles as a type
  check (an empty override was set at import, but Vercel ignores empty
  overrides; it can be switched off)
- Function Region: **Frankfurt (fra1)**
- Prisma client is generated during install by the `postinstall` script
  (`prisma generate`); `generated/` is gitignored and never committed.

**Environment variables (all set as Sensitive — values cannot be viewed
after saving; to change one, overwrite it):**

| Variable | Environment | Value |
|---|---|---|
| `DATABASE_URL` | Production | Neon **production** branch, **pooled** string (host contains `ep-plain-glitter-b28t3bu8-pooler`) |
| `DATABASE_URL` | Preview | Neon **development** branch, **pooled** string |
| `FRONTEND_URL` | Production | `https://terhal-frontend.vercel.app` — used as the CORS allowed origin |

`NODE_ENV` is set to `production` by Vercel automatically — don't add it.
Environment variable changes only apply to **new** deployments (redeploy
after editing).

**Health checks:**
- `GET /health` — process is up (no DB access)
- `GET /health/process` — runs `SELECT 1` against the database

**Failure behavior:** `src/shared/utils/prisma.ts` throws at load time if
`DATABASE_URL` is missing, so a deployment without it fails **every**
request, including `/health`.

### 2.2 Vercel — frontend (`terhal-frontend`) — LIVE

- Framework Preset: Next.js (auto-detected), Root Directory `frontend`, all
  build settings default
- Function Region: **Frankfurt (fra1)**
- Environment variable: `NEXT_PUBLIC_API_URL` = `https://terhal-backend-fawn.vercel.app`
  (Production and Preview). Anything prefixed `NEXT_PUBLIC_` is compiled
  into the browser bundle — never put secrets there.

### 2.3 Neon Postgres — LIVE

- Project `Terhal`, region **AWS Europe Central 1 (Frankfurt)**, free plan.
- Branch `production` → used by Vercel Production and by `migrate.yml`.
- Branch `development` → used by Vercel Preview deployments. It already
  has the same schema; after future migrations, use **Reset from parent**
  in Neon to copy production's schema into it.
- Computes **scale to zero** when idle; the first request after a quiet
  period takes about a second longer.

**Two connection strings per branch** — they differ only by `-pooler` in the host:

| String | Host looks like | Used by |
|---|---|---|
| Pooled | `ep-xxxx-pooler.c-6.eu-central-1.aws.neon.tech` | The app at runtime (`DATABASE_URL` on Vercel) |
| Direct | `ep-xxxx.c-6.eu-central-1.aws.neon.tech` | Migrations only (GitHub secret `DIRECT_DATABASE_URL`) |

The `ep-…` name identifies the branch — always check it before pasting a
string anywhere. (This was mixed up once: the first migration ran against
`development` because the direct string was copied from the wrong branch.)

Strings end in `?sslmode=require&channel_binding=require`. If any tool ever
errors on `channel_binding`, remove that parameter; `sslmode=require` keeps
the connection encrypted.

**Prisma 7 detail:** there is no `url` in `schema.prisma`. The connection
string comes from `backend/prisma.config.ts`, which reads `DATABASE_URL`.
That's why the migration workflow sets `DATABASE_URL` to the direct string.
The schema is split across `backend/prisma/schema/*.prisma`
(`schema.prisma` has only the generator/datasource), migrations live in
`backend/prisma/migrations/`.

### 2.4 GitHub Actions + branch protection — LIVE

**`ci.yml`** — runs on every PR into `main` and every push to `main`:
- **Frontend** job (`frontend/`): `npm ci` → `npm run lint` →
  `npx next typegen` → `npx tsc --noEmit` → `npm run build` → `npm test`.
  `next typegen` must come before `tsc`: Next.js 16 page/layout types like
  `LayoutProps<"/">` are generated, not written by hand.
- **Backend** job (`backend/`): `npm ci` → `prisma generate` →
  `prisma validate` → `npm run build` → `npm test`. Uses a dummy
  `DATABASE_URL` because `prisma.config.ts` needs one defined even for
  commands that never connect.
- `npm test` is a placeholder in both apps (`echo "no tests yet"`) until
  real tests exist.

**`migrate.yml`** — runs `npx prisma migrate deploy` against production:
- automatically on push to `main` when `backend/prisma/migrations/**` or
  `backend/prisma/schema/**` change
- manually via **Actions → Deploy DB Migrations → Run workflow**
- `concurrency: migrate-production` so two runs never overlap
- uses secret **`DIRECT_DATABASE_URL`** = Neon **production direct** string

Migrations are deliberately **not** run inside Vercel builds — every
preview build would otherwise try to migrate.

**Ruleset `protect-main`** (active on the default branch):
- changes only via pull request (0 required approvals for now)
- required checks: **Frontend** and **Backend**
- deletions and force pushes blocked
- direct `git push` to `main` is rejected with `GH013: Repository rule violations`

**Everyday flow for everyone:**
```
git checkout main && git pull
git checkout -b my-change
# ...work, commit...
git push -u origin my-change
# open PR → wait for green checks → merge → Vercel deploys production
```

Note: `.github/workflows/` files can't be written by Claude's remote file
tools (protected path) — edit them by hand or with Claude Code.

---

## 3. Planned Services (not integrated yet)

The designs below were decided before the first deployment and still stand.
Each becomes LIVE when its integration lands.

### 3.1 Cloudflare R2 (object storage) — PLANNED
Stores files that don't belong in the database: **driver expense receipts**
attached to end-of-trip reports, and **driver/vehicle documents** (license,
registration, insurance). Customer payment screenshots are **not** uploaded
to the platform — per `master-doc.md` Section 7 they're sent to staff
off-platform. Chosen over S3 for zero egress fees.
- Upload: the API generates a short-lived **signed upload URL**; the browser
  uploads directly to R2 (keeps large files off Vercel's function limits).
- Download: the API generates a short-lived **signed read URL**.
- Soft dependency: if R2 is down, uploads fail but booking/assignment works.
- Local development uses LocalStack's S3 emulation (`docker-compose.yml`,
  `localstack/init.sh` creates the bucket).

### 3.2 Cloudflare Turnstile (bot protection) — PLANNED
Widget on the booking form produces a token; the API verifies it
server-side with Cloudflare's `siteverify` before creating a trip.
**OPEN:** fail-open or fail-closed if `siteverify` itself is unreachable.

### 3.3 Google Places API (location autocomplete) — PLANNED
Autocomplete runs browser → Google directly with a domain-restricted key.
The API re-validates the selected place server-side before storing
coordinates. If unreachable, the form degrades to free text, and trip
creation should reject unverified coordinates.

### 3.4 Upstash QStash (delayed jobs) — PLANNED
For time-based work on a serverless host (assignment-deadline escalation,
retrying failed sends). The API schedules an HTTP callback; QStash calls
back a signed request at the scheduled time; the API verifies the
signature before acting.

### 3.5 WhatsApp Business Cloud API (Meta) — PLANNED
Primary channel for trip alerts to staff, confirmations to customers, and
OTPs. Requires Meta Business verification and **pre-approved message
templates — start this early, it has real lead time.** Delivery receipts and
replies arrive via a signature-verified webhook. A sustained outage blocks
new confirmed bookings, so failures here must alert loudly.

### 3.6 Cashier (Visa payments) — PLANNED
Only payment method with a real gateway. Hosted checkout; the **webhook**
(signature-verified) is the source of truth for payment status, not the
browser redirect. All other methods (cash, InstaPay, wallets) are manual,
staff-verified, with no gateway call.

### 3.7 Sentry (error monitoring) — PLANNED
SDKs in both apps. Catches unhandled exceptions only — business failures
(a WhatsApp send returning non-200) must be reported explicitly in code.


### 3.8 Resend (email) — IN CODE (`feature/auth`)
Sends verification codes, password-reset links and staff/admin
invitations (`backend/src/domains/messaging/`). With no `RESEND_KEY` in
development, emails are printed to the console instead; in production a
missing key **throws**, so codes never end up in logs. Needs a verified
sending domain in Resend, so it effectively depends on the custom domain.

### 3.9 Rate limiting — IN CODE (`feature/auth`)
Fixed-window counters in the Postgres `RateLimit` table
(`src/shared/middleware/rateLimit.ts`), keyed by hashed IP / identifier /
user. Replaces the earlier Redis/Upstash idea for this purpose. Client IP
comes from Vercel's `x-forwarded-for`. Expired rows are harmless; clear
locally with `npm run db:clear`.

### 3.10 Auth cookies — IN CODE (`feature/auth`)
JWT access token (15 min) + rotating refresh token in `httpOnly`,
`SameSite=Lax`, `Secure` (production) cookies. Customers/staff use
`access`/`refresh` signed with `APP_SECRET`; admins use
`admin_access`/`admin_refresh` signed with `ADMIN_SECRET`, plus a
5-minute challenge cookie between the password and TOTP steps.
**`SameSite=Lax` only works when the frontend and backend share a site.**
`vercel.app` is a public suffix, so `terhal-frontend.vercel.app` and
`terhal-backend-fawn.vercel.app` are different sites and the browser won't
send the cookies — **sign-in cannot work in production until both apps are
on one custom domain** (e.g. `terhal.com` + `api.terhal.com`). The
alternative (`SameSite=None` + an Origin-checking middleware) is noted in
`token.service.ts` but not built.
---

## 4. Environment Variables and Secrets

**Live now:**

| Name | Where it's set | Environments | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Vercel `terhal-backend` | Production (prod pooled), Preview (dev pooled) | Runtime DB connection |
| `FRONTEND_URL` | Vercel `terhal-backend` | Production | CORS allowed origin |
| `NEXT_PUBLIC_API_URL` | Vercel `terhal-frontend` | Production, Preview | Backend base URL for the browser |
| `DIRECT_DATABASE_URL` | GitHub → Settings → Secrets → Actions | — | Migrations (prod direct string) |

**Needed when `feature/auth` merges** (set on Vercel `terhal-backend`,
Production; mark Sensitive). The backend still boots without them, but the
features that use them fail:

| Name | Used for | If missing |
|---|---|---|
| `APP_SECRET` | Signs customer/staff tokens; keys verification-code hashes | Sign-up, sign-in, verification fail |
| `ADMIN_SECRET` | Signs admin tokens (must differ from `APP_SECRET`) | Admin sign-in fails |
| `TOTP_ENCRYPTION_KEY` | Encrypts admins' 2FA secrets. **Never change once admins exist** — it breaks every authenticator setup | Admin invitation/sign-in fails |
| `RESEND_KEY` | Resend API key | Every email throws in production |
| `RESEND_EMAIL` | Sender address on a Resend-verified domain | Every email throws |

Generate each secret as a long random string, e.g.
`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
`FRONTEND_URL` (already set) is also used to build invitation and reset
links. `STAFF_EMAIL` / `ADMIN_EMAIL` are only for `npm run db:seed`, which
sends the first invitations; run it once against production from a trusted
machine with the production `DATABASE_URL` and the variables above set
in the shell.

**Planned (add when each integration lands):** `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`,
`TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`,
`GOOGLE_PLACES_SERVER_API_KEY`, `NEXT_PUBLIC_GOOGLE_PLACES_BROWSER_API_KEY`,
`QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`,
`WHATSAPP_CLOUD_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
`WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `CASHIER_API_KEY`,
`CASHIER_MERCHANT_ID`, `CASHIER_WEBHOOK_SECRET`, `SENTRY_DSN`,
`NEXT_PUBLIC_SENTRY_DSN`. (`JWT_SECRET` from the earlier plan is replaced
by `APP_SECRET` / `ADMIN_SECRET`.)

**Local development** uses `.env` in the repo root (copied from
`.env.example`), read by `docker-compose.yml`. It points at the local
Postgres container (`admin:admin@localhost:5432/terhal`) — never put
production strings in it. Note: `backend/` code loads `.env` from its own
folder, so when running the backend outside Docker, set `DATABASE_URL` in
the shell first.

---

## 5. What Happens When Something Fails

| Service | Failure | Effect | Severity |
|---|---|---|---|
| Neon Postgres | Unreachable | Every read/write fails; API returns 5xx | **Critical** |
| Vercel | Platform outage | Whole app down | **Critical** |
| Backend `DATABASE_URL` missing | Deploy without it | Every request fails at startup | **Critical** (config error) |
| GitHub Actions | Down | No CI checks → PRs can't merge; migrations can't run. Production keeps serving. | Degraded |
| R2 *(planned)* | Unreachable | Uploads/viewing documents fail; booking still works | Degraded |
| Turnstile *(planned)* | `siteverify` fails | Depends on fail-open/closed (**OPEN**) | Degraded |
| Google Places *(planned)* | Unreachable | Autocomplete → free text; trip creation rejects unverified coordinates | Degraded |
| QStash *(planned)* | Down | Time-based actions delayed or dropped | Degraded, silent unless alerted |
| WhatsApp *(planned)* | Sends fail | No new confirmed bookings | **High** |
| Cashier *(planned)* | Webhook fails | Paid trips not marked paid; manual reconciliation | **High** for affected trips |
| Sentry *(planned)* | Down | Errors go unreported; app unaffected | Low |

---

## 6. Gotchas Learned During Setup

Each of these cost real debugging time on 2026-09-25/26. Don't reintroduce them.

1. **Don't use `hono/vercel` for the backend.** It's Hono's *Edge* adapter.
   On Vercel's Node runtime it never writes the response, so every request
   hangs until `504 FUNCTION_INVOCATION_TIMEOUT` (logs show
   `this.raw.headers.get is not a function`). Use
   `getRequestListener(app.fetch)` from `@hono/node-server`.
2. **Don't use `@/...` path aliases in the backend.** `tsx` understands
   them, but compiled output keeps them and Node can't resolve them. The
   alias was removed from `backend/tsconfig.json`; use relative imports
   (`./app.js`, `../../shared/utils/prisma.js`). The frontend still has
   `@/*` — that's fine there, Next.js resolves it.
3. **Keep `backend/public/.gitkeep`.** Without a `public/` folder, Vercel's
   "Other" preset fails with *"No Output Directory named 'public' found"*.
   An empty Build Command override does **not** skip the build.
4. **Deployment-specific URLs are frozen.** Addresses like
   `terhal-backend-ljwv8usah-….vercel.app` always serve one old build and
   are behind Vercel login. Test and link only the production domains.
5. **Sensitive Vercel variables can't be read back.** To verify or fix one,
   overwrite it with a known-good value and redeploy.
6. **Hobby plan = one function region.** Selecting a second region is
   refused; untick the old one (was `iad1`) when choosing `fra1`.
7. **Windows line endings break shell scripts in Docker.** `.gitattributes`
   forces LF for `*.sh`; that fixed `localstack/init.sh`.
8. **Docker installs skip `postinstall`.** `backend/Dockerfile` runs
   `npm install --ignore-scripts`, then `npx prisma generate` after copying
   the schema — otherwise the image build fails.
9. **Editors can silently undo remote edits.** If a file is open with
   auto-save in VS Code/Antigravity when another tool changes it, the
   editor may save its older copy back. Close the tab first.
10. **`npm audit` warnings (4 high)** all come from the `prisma` CLI's
    bundled drivers (`mysql2`, `deepmerge-ts`). Dev-time only, not
    exploitable here. Don't run `npm audit fix --force` — it downgrades to
    Prisma 6 and breaks the setup.
11. **Actions run on Node 20** (`actions/*@v4`, `node-version: 20`), which
    GitHub has deprecated. Bump to `@v5` and Node `22` when next editing the
    workflows.

---

## 7. Open Items

- **Custom domain — now blocking sign-in.** Auth cookies need the frontend
  and backend on one site (Section 3.10). Buy/attach a domain, put the
  frontend on it and the backend on a subdomain (e.g. `api.`), then update
  `FRONTEND_URL` and `NEXT_PUBLIC_API_URL` and redeploy both. Resend also
  needs a verified domain to send from.
- **Admin vs Staff** — `feature/auth` kept `Admin` as a separate login
  system (mandatory TOTP) alongside `User`→`Staff`. Confirm with the team;
  see `master-doc.md` Section 18, item 10.
- **First accounts in production** — after merging and setting the
  secrets, run `npm run db:seed` once against production to invite the
  first staff member and admin.
- **Frontend previews vs backend** — frontend Preview builds call the
  *production* backend, and the backend Preview has no `FRONTEND_URL`.
  The auth pages now call the API, so this matters as soon as previews are
  used for testing.
- **Turnstile fail-open vs fail-closed** — undecided.
- **Local Docker/LocalStack setup** still exists for local development.
  Keep or retire deliberately; it is not used in production.
