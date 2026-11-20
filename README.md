# Terhal

pnpm workspace + Turborepo. Read [docs/architecture.md](docs/architecture.md) before adding a module, a job or a
migration.

| Path                 | What                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `apps/server`        | Hono API (`src/app.ts`) and BullMQ worker (`src/worker.ts`), one codebase, Prisma + Neon Postgres |
| `apps/web`           | Next.js: the customer site, the staff dashboard and the admin panel, one host each        |
| `packages/contracts` | Request and response schemas (plain zod), shared by the API and the web app               |
| `tooling/tsconfig`   | Shared TypeScript config                                                                  |
| `tooling/eslint`     | Shared ESLint config (type-aware `typescript-eslint`)                                     |
| `infra`              | Local Postgres, Redis (cache) and Redis (queue)                                           |
| `deploy`             | Docker Compose stacks, Caddy and scripts for the VPS                                      |
| `docs`               | Architecture and decision records                                                         |

Everything except the database runs in Docker on one VPS, behind Caddy. The database is Neon (`main` and `staging`
branches).

## Hosts

Each audience gets its own origin, so a bug on one site can't act on another. `apps/web/proxy.ts` maps each host onto its
section of the app (`app/site`, `app/staff`, `app/admin`), and the API only accepts each audience's routes from its own
origin.

|          | Local                                 | Staging                               | Production                    |
| -------- | ------------------------------------- | ------------------------------------- | ----------------------------- |
| Customer | `https://local.terhal.co:3000`        | `https://staging.terhal.co`           | `https://terhal.co`           |
| Staff    | `https://dashboard.local.terhal.co:3000` | `https://dashboard.staging.terhal.co` | `https://dashboard.terhal.co` |
| Admin    | `https://admin.local.terhal.co:3000`  | `https://admin.staging.terhal.co`     | `https://admin.terhal.co`     |
| API      | `https://api.local.terhal.co:8080`    | `https://api.staging.terhal.co`       | `https://api.terhal.co`       |

## Local development

Locally everything runs over https on `local.terhal.co` and its subdomains, mirroring production. Plain `localhost`
doesn't work: browsers treat `admin.localhost` and `localhost` as different sites, so they drop the API's `SameSite=Lax`
auth cookies. The frontends and the API have to share a registrable domain, as they do in production. `.co` doesn't force
https the way `.app` does, but the cookies are `Secure`, so local development runs on https too.

### One-time setup

**1. Point the local hostnames at your machine** by adding these lines to your hosts file:

```
127.0.0.1 local.terhal.co
127.0.0.1 dashboard.local.terhal.co
127.0.0.1 admin.local.terhal.co
127.0.0.1 api.local.terhal.co
```

macOS / Linux, the file is `/etc/hosts`:

```sh
printf '127.0.0.1 %s\n' local.terhal.co dashboard.local.terhal.co admin.local.terhal.co api.local.terhal.co | sudo tee -a /etc/hosts
```

Windows, the file is `C:\Windows\System32\drivers\etc\hosts`. In PowerShell run as Administrator:

```powershell
"local.terhal.co", "dashboard.local.terhal.co", "admin.local.terhal.co", "api.local.terhal.co" | ForEach-Object { Add-Content -Path "$env:SystemRoot\System32\drivers\etc\hosts" -Value "127.0.0.1 $_" }
```

**2. Create trusted certificates with [mkcert](https://github.com/FiloSottile/mkcert).** `mkcert -install` adds a local
certificate authority to your system's trust store, so browsers trust certificates it creates. Run it once per machine.
The certificate names `local.terhal.co` as well as the wildcard, since a wildcard doesn't cover the name it's under.

macOS / Linux:

```sh
brew install mkcert              # Linux without Homebrew: see the mkcert README
mkcert -install
mkdir -p .certs && mkcert -cert-file .certs/local.pem -key-file .certs/local-key.pem local.terhal.co "*.local.terhal.co"
```

Windows (PowerShell, from the repo root):

```powershell
choco install mkcert             # or: scoop bucket add extras; scoop install mkcert
mkcert -install
New-Item -ItemType Directory -Force .certs | Out-Null; mkcert -cert-file .certs/local.pem -key-file .certs/local-key.pem local.terhal.co "*.local.terhal.co"
```

`.certs/` is git-ignored. Firefox keeps its own trust store: on macOS / Linux install `nss` (`brew install nss`) before
`mkcert -install`.

### Running

```sh
pnpm install
pnpm infra:up                        # Postgres on :5432, cache Redis on :6379, queue Redis on :6380
cp apps/server/.env.example apps/server/.env # then set ADMIN_SECRET and TOTP_ENCRYPTION_KEY: openssl rand -base64 32
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @terhal/server db:deploy

pnpm dev                             # API server + web
pnpm --filter @terhal/server dev:worker
```

Open `https://local.terhal.co:3000` for the customer site, `https://dashboard.local.terhal.co:3000` for staff and
`https://admin.local.terhal.co:3000` for admin.

### API docs

`https://api.local.terhal.co:8080/v1/docs` while `pnpm dev` runs (also on staging, never in production), from the
OpenAPI document at `/v1/openapi.json`. `apps/server/openapi.json` is the committed contract: the contract test fails
when the API changes it; after an intended change, regenerate it with `pnpm --filter @terhal/server test -u` and commit
it with the change.

## Checks

```sh
pnpm lint          # ESLint (type-aware, plus the server's layer rules) in every workspace that has a config
pnpm format        # Prettier, writes changes; CI runs pnpm format:check
pnpm typecheck
pnpm test          # Needs Docker: starts throwaway Postgres and Redis containers
```

## The VPS

One Ubuntu 24.04 box, ideally in Frankfurt next to Neon's AWS Frankfurt region, runs both environments:

```
/opt/terhal/edge      Caddy on :80/:443, the only thing that publishes a port. TLS for every host, routes from sites/
/opt/terhal/staging   server, worker, web, cache Redis, queue Redis (deploy/compose.yml), secrets in app.env
/opt/terhal/main      the same, for production
```

Caddy reaches each environment's server and web app over the shared `edge` Docker network (as `staging-server`,
`main-web` and so on). Each environment keeps its own Redis containers; the cache may evict (`allkeys-lru`), the queue
never does (`noeviction`, AOF on a volume). `DATABASE_URL` is the Neon branch's pooled URL and `DATABASE_URL_UNPOOLED`
its direct URL, used only for migrations.

### Deploys

`.github/workflows/deploy.yml` runs after CI passes on a push to `staging` or `main`:

1. Builds the server image (API, worker and migrations) and the web image for that environment (the API's URL is baked
   in at build time), and pushes both to `ghcr.io/ammarsarhan`, tagged with the commit.
2. Over SSH as `deploy`, copies `deploy/compose.yml` and `deploy/caddy/<env>.caddy` to the VPS and runs `deploy/deploy.sh`:
   pull, migrate, `docker compose up --wait` until every container is healthy, then reload Caddy with the routes.
3. Checks `/health` from outside, through DNS and TLS.

If a step fails, whatever was running keeps serving. To redeploy a commit, re-run its Deploy run in the Actions tab. To roll
back by hand: `cd /opt/terhal/<env> && cp .env.previous .env && docker compose up -d --wait` (migrations aren't undone).
From `/opt/terhal/<env>`, plain `docker compose ps`, `logs -f server` and `restart` work.

### Setting up a VPS

1. **Create a deploy key** (on your machine): `ssh-keygen -t ed25519 -N "" -C terhal-deploy -f terhal-deploy`.
2. **Bootstrap the box** (Docker, firewall, `deploy` user, automatic security updates, swap):
   `ssh root@<vps> 'bash -s' -- "$(cat terhal-deploy.pub)" < deploy/bootstrap.sh`
3. **Point DNS at it.** A records (and AAAA, if the box has IPv6) to the VPS for `terhal.co`, `www`, `dashboard`, `admin`,
   `api`, `staging`, `dashboard.staging`, `admin.staging` and `api.staging`. Only add production's once it launches.
4. **Start the edge:**
   ```sh
   scp deploy/edge/compose.yml deploy/edge/Caddyfile deploy@<vps>:/opt/terhal/edge/
   ssh deploy@<vps> 'cd /opt/terhal/edge && echo "ACME_EMAIL=<your email>" > .env && docker compose up -d'
   ```
   Changes to `deploy/edge/` are copied by hand the same way, followed by
   `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`.
5. **Write each environment's secrets:** copy `deploy/app.env.example` to `/opt/terhal/<env>/app.env` and fill it in
   (`chmod 600`).
6. **Add the GitHub environment** (Settings → Environments, named `staging` or `main`) with the secrets `VPS_HOST`,
   `VPS_SSH_KEY` (the contents of `terhal-deploy`) and `VPS_KNOWN_HOSTS` (`ssh-keyscan -t ed25519 <vps>`). For an ARM
   box, set the repository variable `VPS_PLATFORM` to `linux/arm64`. Then delete the key files from your machine.
7. **Push to the branch** (or re-run its last Deploy run).

**Client IPs.** Rate limits read the caller's address from the header named by `CLIENT_IP_HEADER` (`x-real-ip` on the
VPS), which Caddy overwrites with the address that actually connected. Unset, as locally, they use the socket's address. This only holds while nothing reaches the server except through Caddy, so never publish the server's
port. In every new environment, check that a spoofed header is ignored: send the same failing sign in with a different
`X-Real-IP` each time and make sure the limit still kicks in. If Cloudflare's proxy is ever put in front, Caddy will see
Cloudflare's addresses instead: configure `trusted_proxies` and read `CF-Connecting-IP` then.

## Branches and releases

Work happens on `dev`. Changes reach `staging` and then `main` only through PRs (CI rejects a PR into `staging` from
anything but `dev`, and into `main` from anything but `staging`), which need a passing `check` and have to
be up to date with their base. Merge them with a merge commit (squash and rebase are turned off):

```sh
gh pr merge <number> --merge --subject "<message>."
```

After each merge into `staging` or `main`, the Sync dev workflow fast-forwards `dev` to it, so `dev` always contains both
branches and the next PR up the chain is never behind. Pull `dev` before starting new work. If you committed to `dev`
while a merge was landing, the workflow can't fast-forward it and says so; merge that branch into `dev` by hand.
