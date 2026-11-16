# Infrastructure

> Where Terhal runs and how code reaches it. `docs/architecture.md` covers how
> the code is organised; the README covers the commands.
>
> **Last updated: 2026-11-16**, after the first successful staging deploy to
> the VPS. This repo is public: no secret, password or key belongs in this
> file.

---

## 0. Current state at a glance

| Piece | Status | Where |
|---|---|---|
| Staging: customer site | **LIVE** (placeholder page) | `https://staging.terhal.co` |
| Staging: staff dashboard | **LIVE** | `https://dashboard.staging.terhal.co` |
| Staging: admin panel | **LIVE** (Staff, Customers, Pricing, Locations, Settings, Audit logs) | `https://admin.staging.terhal.co` |
| Staging: API | **LIVE**, `/health/ready` reports database and cache ok | `https://api.staging.terhal.co` |
| Production (`terhal.co`, `www`, `dashboard`, `admin`, `api`) | **NOT SET UP** (no DNS, no `app.env`). Every merge to `main` shows a failed Deploy until Section 6 is done; harmless | — |
| Server | **LIVE** | Hostinger VPS KVM 2 (2 vCPU, 8 GB, 100 GB), Ubuntu 24.04, Germany – Düsseldorf, IPv4 `179.67.200.86`, hostname `srv2164412.hstgr.cloud` |
| Database | **LIVE** | Neon project `terhal` (`floral-art-29776297`), AWS Frankfurt, branches `production` and `staging` |
| Email | **LIVE** | Resend, domain `terhal.co` verified, sender `no-reply@terhal.co` |
| DNS | **LIVE** for staging | Namecheap, `terhal.co` |
| CI and deploys | **LIVE** | GitHub Actions in `ODorgham11/terhal` |
| First admin (staging) | **DONE** 2026-11-16, with 2FA | — |

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
        │                       (not running yet)            │
        └───────────────────────┬──────────────────────────┘
                                │ TLS
                                ▼
                 Neon Postgres (Frankfurt)
                 branch staging     ← staging
                 branch production  ← main (when set up)

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
| TXT | `resend._domainkey` | DKIM key | Resend |
| CNAME | `rsend`, `send` | Resend hosts | Resend |
| TXT | `_dmarc` | `v=DMARC1; p=none;` | Resend |

Production records (`@`, `www`, `dashboard`, `admin`, `api`) are added at
launch.

### 2.5 Resend

Free plan (3,000 emails a month, 100 a day).
API key `terhal-staging` (sending access). Sends admin invitations and
other account emails.

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
| Staging `app.env` (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `RESEND_KEY`, `ADMIN_SECRET`, `TOTP_ENCRYPTION_KEY`, the three URLs) | `/opt/terhal/staging/app.env` on the VPS (mode 600, owner `deploy`). One offline backup, kept by Omar |
| Deploy SSH key, host, known-hosts | GitHub environment secrets, `staging` and `main` |
| VPS root password | Password manager (password login over SSH is off) |
| Staging admin login + 2FA | Password manager + authenticator app |

Rules:
- Production gets its **own** `ADMIN_SECRET` and `TOTP_ENCRYPTION_KEY`,
  never staging's.
- Never change `TOTP_ENCRYPTION_KEY` once admins exist; it breaks every
  authenticator setup.
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
   `-T ... < /dev/null`. On `staging`; reaches `main` with the next
   `staging → main` PR.
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

---

## 6. To launch production

1. Namecheap: A records for `@`, `www`, `dashboard`, `admin`, `api` →
   the server's IP.
2. Neon: copy the `production` branch's pooled and direct strings.
3. Write `/opt/terhal/main/app.env` from `deploy/app.env.example`:
   `APP_ENV=production`, URLs without `.staging`, new secrets,
   `RESEND_EMAIL=Terhal <no-reply@terhal.co>`; `chmod 600`, owner `deploy`.
4. Re-run the last Deploy for `main`; check
   `https://api.terhal.co/health/ready`.
5. Seed the first production admin; run the spoofed `X-Real-IP` rate-limit
   test against `api.terhal.co` (expect 429 from the 11th attempt).

---

## 7. Moving to the client's server

Repeat the VPS setup on the new box (bootstrap, edge Caddy, both `app.env`
files, a new deploy key and updated GitHub secrets), deploy and test it,
then change the DNS A records to the new IP. Delete the old server a day
later. The database does not move.

---

## 8. Open items

- Production setup (Section 6).
- Hostinger renewal on 2026-12-15: decide before then.
- The repo is public; confirm that is intended for client work.
- No uptime monitoring or alerting on the VPS yet.
- The old Vercel projects and the old Neon project can be deleted.
- Integrations planned and not built: Cloudflare R2,
  Turnstile, Google Places, WhatsApp Cloud API, Cashier, Sentry. Delayed
  jobs now run on the BullMQ worker with the queue Redis (the earlier
  Upstash QStash plan is dropped). Rate limits are in Redis, not Postgres.
