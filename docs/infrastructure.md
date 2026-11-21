# Infrastructure

> Where Terhal runs and how code reaches it. `docs/architecture.md` covers how
> the code is organised; the README covers the commands.
>
> **Last updated: 2026-11-16**, after the production launch on the
> VPS. This repo is public: no secret, password or key belongs in this
> file.

---

## 0. Current state at a glance

| Piece | Status | Where |
|---|---|---|
| Staging: customer site | **LIVE** (placeholder page) | `https://staging.terhal.co` |
| Staging: staff dashboard | **LIVE** | `https://dashboard.staging.terhal.co` |
| Staging: admin panel | **LIVE** (Staff, Customers, Pricing, Locations, Settings, Audit logs) | `https://admin.staging.terhal.co` |
| Staging: API | **LIVE**, `/health/ready` reports database and cache ok | `https://api.staging.terhal.co` |
| Production: customer site | **LIVE** since 2026-11-16 | `https://terhal.co` (`www` redirects to it) |
| Production: staff dashboard | **LIVE** | `https://dashboard.terhal.co` |
| Production: admin panel | **LIVE** | `https://admin.terhal.co` |
| Production: API | **LIVE**, `/health/ready` reports database and cache ok | `https://api.terhal.co` |
| Server | **LIVE** | Hostinger VPS KVM 2 (2 vCPU, 8 GB, 100 GB), Ubuntu 24.04, Germany – Düsseldorf, IPv4 `179.67.200.86`, hostname `srv2164412.hstgr.cloud` |
| Database | **LIVE** | Neon project `terhal` (`floral-art-29776297`), AWS Frankfurt, branches `production` and `staging` |
| Email | **LIVE** | Resend, domain `terhal.co` verified, sender `no-reply@terhal.co` |
| DNS | **LIVE** for staging and production | Namecheap, `terhal.co` |
| CI and deploys | **LIVE** | GitHub Actions in `ODorgham11/terhal` |
| First admin (staging) | **DONE** 2026-11-16, with 2FA | — |
| First admin (production) | **DONE** 2026-11-16, with 2FA | — |

**The server is temporary.** It was bought for one month (expires
2026-12-15, auto-renew on, at a higher price) to finish the client's project.
The plan is to move to a server set up for the client afterwards (Section 7).

**Retired:** the Vercel projects `terhal-frontend` and `terhal-backend`, the
old Neon project used with them, and the old repo layout (`frontend/`,
`backend/`).

---

## 1. Topology

```
                     Browser (customers, staff, admins)
                                  │ HTTPS
                                  ▼
        ┌──────────────────────────────────────────────────┐
        │ Hostinger VPS 179.67.200.86 (Ubuntu 24.04)        │
        │                                                    │
        │  /opt/terhal/edge     Caddy :80/:443, TLS for      │
        │                       every host (Let's Encrypt)   │
        │        │ Docker network "edge"                     │
        │        ▼                                           │
        │  /opt/terhal/staging  server, worker, web,         │
        │                       cache Redis, queue Redis     │
        │  /opt/terhal/main     the same, for production     │
        └───────────────────────┬──────────────────────────┘
                                │ TLS
                                ▼
                 Neon Postgres (Frankfurt)
                 branch staging     ← staging
                 branch production  ← main

   GitHub (ODorgham11/terhal)
     dev ──PR──▶ staging ──PR──▶ main
     push to staging or main → CI → Deploy:
       build images → push to ghcr.io/odorgham11 → SSH to the VPS as
       "deploy" → deploy/deploy.sh (pull, migrate, start, reload Caddy)
       → check /health/ready from outside
```

Only Caddy publishes ports. Nothing reaches the server or web containers
except through it; that is what makes the client IP header trustworthy for
rate limits.

### Why one VPS (decided 2026-11-02)

Terhal started on Render (API, worker, Redis) and Vercel (web), on free
plans. Free web services sleep after 15 minutes, the free Key Value instance
keeps nothing across restarts, and the worker has no free plan, so the parts
Terhal needs most were the ones being put off. Terhal is single-tenant: one
company's traffic.

So everything except the database runs in Docker on one VPS: per environment
(staging, main) a Compose stack with the server, the worker, the web app and
two Redis containers, behind one shared Caddy that terminates TLS for every
host. The database stays on Neon, for backups, point-in-time restore and
branches. GitHub Actions builds the images, pushes them to GHCR and deploys
over SSH once CI passes (`deploy/`, `.github/workflows/deploy.yml`).

What we gave up:

- Operations are ours: OS updates, the firewall, monitoring, restarts.
- One box is a single point of failure for the site, the API and the worker.
- Deploys recreate containers, so there are a few seconds of downtime per
  deploy.

When an hour of downtime starts to cost real money, add a second box behind a
load balancer. The server is stateless (sessions in Postgres, limits and
queues in Redis), so that needs no rewrite.

---

## 2. The pieces

### 2.1 Repo

- `github.com/ODorgham11/terhal` (transferred from `ammarsarhan/terhal` on
  2026-11-15; this is the restructured codebase from 2026-11-02).
- pnpm workspace + Turborepo, Node 24, pnpm 10.6.3.
- `apps/server` (Hono API + BullMQ worker, Prisma), `apps/web` (Next.js:
  site, staff dashboard, admin panel, one host each), `packages/contracts`,
  `deploy/` (Compose, Caddy, scripts), `infra/` (local Postgres and Redis).

### 2.2 VPS

Set up once by `deploy/bootstrap.sh`: Docker, `ufw` (SSH, 80, 443 only),
fail2ban, automatic security updates, 2 GB swap, password login off, and a
`deploy` user that CI logs in as.

- **Access:** `ssh root@179.67.200.86` with a personal key registered in
  Hostinger (Omar's). If that machine is lost, use Hostinger's web console
  or add a new key in hPanel.
- **Deploy key:** exists only as the GitHub secret `VPS_SSH_KEY`; the local
  copy was deleted. To replace it, make a new key, write its public half to
  `/home/deploy/.ssh/authorized_keys`, and update the secret.
- **No Hostinger panel firewall** is configured; `ufw` on the box is the
  firewall. Hostinger's Docker Manager and malware scanner were left off.
- **Backups:** Hostinger's free weekly snapshot only. The database is not on
  the box, so the only state here is the two `app.env` files, the Caddy
  certificates and the queue Redis volume.

Useful commands on the box, from `/opt/terhal/<env>`:
`docker compose ps`, `docker compose logs -f server`, `docker compose restart`.

### 2.3 Neon

- Project `terhal`, region AWS Europe Central 1 (Frankfurt), free plan.
- Branch `staging` → staging. Branch `production` → the `main` environment.
  (The repo's README calls it `main`; Neon named the default branch
  `production`. Only the connection strings matter.)
- Each environment uses two strings: pooled (`DATABASE_URL`, runtime) and
  direct (`DATABASE_URL_UNPOOLED`, migrations).
- Migrations run inside each deploy, before the new containers start.

### 2.4 DNS (Namecheap)

| Type | Host | Value | For |
|---|---|---|---|
| A | `staging`, `dashboard.staging`, `admin.staging`, `api.staging` | `179.67.200.86` | Staging |
| A | `@`, `www`, `dashboard`, `admin`, `api` | `179.67.200.86` | Production |
| TXT | `resend._domainkey` | DKIM key | Resend |
| CNAME | `rsend`, `send` | Resend hosts | Resend |
| TXT | `_dmarc` | `v=DMARC1; p=none;` | Resend |

`www.terhal.co` only redirects to `terhal.co` (`deploy/caddy/main.caddy`).

### 2.5 Resend

Free plan (3,000 emails a month, 100 a day).
API keys `terhal-staging` and `terhal-production` (sending access, domain
`terhal.co`), one per environment, so either can be revoked without
breaking the other. Sends admin invitations and other account emails.

### 2.6 GitHub Actions

- `ci.yml`: lint, typecheck, test, build on `dev`, `staging`, `main`; also
  enforces that PRs into `staging` come from `dev` and into `main` from
  `staging`.
- `deploy.yml`: runs after CI passes on a push to `staging` or `main`.
  **GitHub always runs this workflow file from `main`**, so a change to it
  only takes effect once it reaches `main`. `deploy/deploy.sh`, by contrast,
  is taken from the commit being deployed.
- `sync-dev.yml`: fast-forwards `dev` after each merge into `staging` or
  `main`.
- Environments `staging` and `main` each hold the secrets `VPS_HOST`,
  `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`.

---

## 3. Secrets: what lives where

| Secret | Where |
|---|---|
| Staging `app.env` (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `RESEND_KEY`, `ADMIN_SECRET`, `STAFF_SECRET`, `CUSTOMER_SECRET`, `TOTP_ENCRYPTION_KEY`, `REPORT_LINK_SECRET`, the storage keys, the three URLs) | `/opt/terhal/staging/app.env` on the VPS (mode 600, owner `deploy`). One backup, in Omar's password manager |
| Production `app.env` (the same variables, with its own values) | `/opt/terhal/main/app.env` on the VPS (mode 600, owner `deploy`). One backup, in Omar's password manager |
| Deploy SSH key, host, known-hosts | GitHub environment secrets, `staging` and `main` |
| VPS root password | Password manager (password login over SSH is off) |
| Staging admin login + 2FA | Password manager + authenticator app |
| Production admin login + 2FA | Password manager + authenticator app (a separate entry from staging's) |

Rules:
- Production gets its **own** value of every secret, never staging's.
- Never change `TOTP_ENCRYPTION_KEY` once admins exist; it breaks every
  authenticator setup. `REPORT_LINK_SECRET` can be changed at any time: it
  only breaks the drivers' live report links, and staff make new ones.
- No secret goes in git, in a `NEXT_PUBLIC_` variable, or in a screenshot.

---

## 4. Everyday flow

```
git checkout dev && git pull
# work, commit
git push
# PR dev → staging, wait for green checks, merge (merge commit)  → staging deploys
# PR staging → main, merge                                        → production deploys
```

Never delete `dev` or `staging` after a merge. To redeploy a commit, re-run
its Deploy run in the Actions tab.

---

## 5. Gotchas learned during setup (2026-11-15/16)

1. **Image names must be lowercase.** The repo owner is `ODorgham11`, and
   Docker rejects capitals. `deploy.yml` now lowercases the registry
   (`${REGISTRY,,}`). Fixed and on `main`.
2. **`deploy.sh` is piped over SSH, so nothing in it may read stdin.**
   `docker compose run --rm migrate` swallowed the rest of the script: the
   deploy went green after 16 seconds with no containers started. Fixed with
   `-T ... < /dev/null`. On `main` since PR #18 (2026-11-16). Re-running an
   older Deploy run uses that commit's `deploy.sh`, so never re-run one from
   before this fix; merge a new `staging → main` PR instead.
3. **A green "Deploy" step is not proof.** Trust the final "Check the API"
   step, or `docker ps` on the box.
4. **Windows clones need LF line endings.** With `core.autocrlf` on,
   `bootstrap.sh` fails with `invalid option namepefail`. Fix on a fresh
   clone: `git config core.autocrlf false && git rm -rq --cached . &&
   git reset --hard`. `.gitattributes` now forces LF, so new clones are fine.
5. **The README's bootstrap command loses the deploy key.**
   `ssh root@<vps> 'bash -s' -- "$(cat key.pub)"` passes only the first word.
   Use `ssh root@<vps> "bash -s -- '$(cat key.pub)'" < deploy/bootstrap.sh`.
   The README now has the working form.
6. **Neon's new-branch dialog defaults to auto-delete after 1 day.** Set it
   to never for long-lived branches.
7. **Let's Encrypt rejects `example.com` addresses** for `ACME_EMAIL`.
8. **The first-admin seed runs from a laptop**, not the server (the image
   has no seed script). It needs dummy `CACHE_URL`/`QUEUE_URL` values and
   prints harmless Redis errors. Re-running it before the invitation is
   accepted revokes the earlier link.
9. **Use Git Bash on Windows**, not PowerShell, for every command in the
   repo's README.
10. **Check a new DNS record against Namecheap's own nameserver.** A typo in
    a host (`dashoard`) made a public resolver cache "non-existent domain"
    for the correct name. `nslookup <host> dns1.registrar-servers.com` skips
    that cache. A saved record takes a minute or two to appear there.
11. **A pasted connection string can carry a trailing space or quote.** Only
    the `postgresql://...` URL goes in `app.env`, with nothing around it.
12. **`gh` needs `gh auth login` once per machine.** Without it, open and
    merge PRs in the browser (merge commit, never delete `staging`).

---

## 6. Production launch (done 2026-11-16)

What was done, in order. Repeat it for a new environment or a new server.

1. Namecheap: A records for `@`, `www`, `dashboard`, `admin`, `api` →
   the server's IP. Each one checked with `nslookup` (gotcha 10).
2. Neon: copied the `production` branch's pooled and direct strings, and
   confirmed their endpoint (`ep-...`) differs from staging's.
3. Wrote `/opt/terhal/main/app.env` from `deploy/app.env.example`:
   `APP_ENV=production`, URLs without `.staging`,
   `RESEND_EMAIL=Terhal <no-reply@terhal.co>`, and a new `ADMIN_SECRET` and
   `TOTP_ENCRYPTION_KEY` generated on the server with
   `openssl rand -base64 32`; `chmod 600`, owner `deploy`.
4. Merged `staging → main` (PR #18). That brought the `deploy.sh` fix
   (gotcha 2) to `main` and ran the first production deploy (Deploy #14).
   Re-running the previous Deploy for `main` would have used the broken
   script. Checked all five hosts and `https://api.terhal.co/health/ready`
   from outside.
5. Seeded the first production admin from a laptop (gotcha 8) and deleted
   the temporary `apps/server/.env` afterwards. Ran the spoofed `X-Real-IP`
   rate-limit test against `api.terhal.co`: 429 from the 11th attempt.

---

## 7. Moving to the client's server

Repeat the VPS setup on the new box (bootstrap, edge Caddy, both `app.env`
files, a new deploy key and updated GitHub secrets), deploy and test it,
then change the DNS A records to the new IP. Delete the old server a day
later. The database does not move.

---

## 8. Open items

- **Add `STAFF_SECRET`, `CUSTOMER_SECRET` and `REPORT_LINK_SECRET` to both
  `app.env` files** (`/opt/terhal/{staging,main}/app.env`,
  `openssl rand -base64 32` each)
  before the next deploy: the server refuses to start without them.
- **Create the Cloudflare R2 buckets and keys, then set them in both
  `app.env` files before the next deploy**: outside local development the
  server refuses to start unless `STORAGE_DRIVER=s3` and every `S3_`
  variable is set (`deploy/app.env.example`). One private bucket per
  environment (e.g. `terhal-staging`, `terhal-production`), each with an R2
  API token limited to Object Read & Write on it; `S3_ENDPOINT` is
  `https://<account id>.r2.cloudflarestorage.com`.
- **Wipe the staging and production databases before their next deploy.**
  The domain migrations were edited after both had applied them (the schema
  rebuild of 2026-11-21, see `docs/architecture.md`, Migrations), and
  `prisma migrate deploy` doesn't re-run an applied migration. Decided to do
  it later, before the release that brings the new schema.
- Hostinger renewal on 2026-12-15: decide before then.
- The repo is public; confirm that is intended for client work.
- No uptime monitoring or alerting on the VPS yet.
- The old Vercel projects and the old Neon project can be deleted.
- Integrations planned and not built:
  Turnstile, Google Places, WhatsApp Cloud API, Cashier, Sentry. Delayed
  jobs now run on the BullMQ worker with the queue Redis (the earlier
  Upstash QStash plan is dropped). Rate limits are in Redis, not Postgres.
