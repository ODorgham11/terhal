# Architecture

How the Terhal API is built to stay correct, survive failures and grow. Read this before adding a module, a job or a
migration.

## Principles

- **Correctness first.** No lost bookings, no double-sold seats, no session that outlives its rules. Postgres handles a
  single company's load easily, so the risk is in query shape and concurrency, not traffic.
- **Postgres is the source of truth.** Every invariant the database can hold is enforced there (CHECKs, unique and
  partial indexes, foreign keys, triggers such as the append-only audit log). Redis holds nothing that can't be rebuilt.
- **Assume every dependency fails.** Redis, the email provider, the network, a deploy halfway through. Each failure must
  be detected, contained and recoverable without losing data.
- **Write decisions down.** Significant decisions get an entry in [`decisions.md`](decisions.md): the context, the
  decision, and what we gave up.

## Non-goals

| Not doing          | Why                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| Microservices      | One team, one database. They'd turn function calls into network failures and take away transactions. |
| Multi-tenancy      | Terhal serves one company. Rehletak was the multi-tenant version. |
| Kubernetes         | One VPS running Docker Compose is enough until it isn't ([why one VPS](infrastructure.md#why-one-vps-decided-2026-11-02)). |
| A generated client | The web app is the only client and ships with the API, so Hono RPC types it ([why](#why-rpc-and-not-a-generated-client-decided-2026-11-02)). |

## Layout

```
apps/
  server/       the API and the worker (Hono, BullMQ, Prisma)
  web/          Next.js: customer site, staff dashboard and admin panel, one host each (proxy.ts)
packages/
  contracts/    request and response schemas (plain zod), shared by the API and the web app
tooling/
  tsconfig/     the shared TypeScript config
  eslint/       the shared, type-aware ESLint config
infra/          local Postgres and Redis (Docker Compose)
deploy/         the VPS: one Compose stack per environment, the edge Caddy, bootstrap and deploy scripts
docs/           this file, infrastructure.md (where it runs) and decisions.md (why it's built this way)
```

## The server: a modular monolith

```
apps/server/src/
  modules/
    identity/       admin invitations, sign in with two-factor, sessions (staff and customers join here)
    audit/          the append-only audit log and the admin panel's view of it
    ...             fleet, trips, pricing, locations, notifications, as they're ported
  platform/         config, db, redis, crypto, email, errors, http, rate limits, logging, jobs, lifecycle
  http/             composition root: global middleware, health, mounts each module's routes under /v1
  app.ts worker.ts  process entry points
  client.ts         the route types the web app's RPC client is built from
```

- Each module has three layers:
  - `http` declares its routes (`createRoute` from `@hono/zod-openapi`), validates input against
    `@terhal/contracts` schemas and serializes output.
  - `application` holds the use cases. They own transactions.
  - `domain` holds pure functions and rules, e.g. session lifetimes. No IO, so they're tested on their own.
- Modules talk through each other's public `index.ts`, never through each other's tables or internals.
- `eslint-plugin-boundaries` enforces this in `pnpm lint` (`apps/server/eslint.config.js`):
  - another module is reachable only through its `index.ts`, and a module's own layers never import that `index.ts`;
  - `http` → `application` → `domain`, never upwards, and module `http` never touches the database;
  - `domain` imports no Prisma, Redis, BullMQ or Hono, and no platform service except errors;
  - `platform` never imports modules or `http`.
- Prisma models never leave the server. Every response is an explicit DTO, so new columns (and secrets like
  `passwordHash`) are never exposed by accident.
- Server imports are relative, never an `@/` alias: the web app type checks the server's source through RPC, and an
  alias would resolve against the web app's own `@/`.

## Contracts, OpenAPI and RPC

- `@terhal/contracts` holds every request and response schema, the error codes and the problem shape. It's plain zod
  with `.meta()`, shipped as TypeScript (the server bundles it with tsup, Next transpiles it).
- Routes are declared with `@hono/zod-openapi`, so one declaration validates the request, generates the OpenAPI
  document and types the web app's client:
  - `GET /v1/openapi.json` is the document and `GET /v1/docs` a browsable page for it (Scalar). Both are served
    everywhere except production, since they list every route.
  - `apps/server/openapi.json` is the committed copy. The contract test fails when the API changes it; after an intended
    change, regenerate it with `pnpm --filter @terhal/server test -u` and commit it with the change, so every API change
    shows up in review.
  - The web app calls the API through `hc<AppType>` (`apps/web/lib/api.ts`), e.g. `api.v1.admin.auth.session.$get()`.
    Module routers are chained (`.openapi(...).openapi(...)`) so their types carry through.
- Single resources come back as the object itself; lists as `{ data, nextCursor }`, never a bare array, so fields can be
  added later.

### Why RPC and not a generated client (decided 2026-11-02)

A common way to type an API's clients is to generate them from a committed OpenAPI document, which pays off when clients
such as mobile apps stay on old versions in the wild. Terhal's only client is its own web app, deployed with the API, and
it was already typed through Hono RPC. We still wanted API documentation and a reviewable contract, which
`@hono/zod-openapi` gives from the same route declarations, so there is no generated client package.

What we gave up:

- The web app type checks against the server's source, so server imports can't use an `@/` path alias.
- Module routers must stay chained for their types to carry through, which constrains how routes are written.
- Should a second client appear (a mobile app, say), it would need a client generated from the committed document.

## Errors

- Expected failures throw `AppError` (`platform/errors/app-error.ts`) with a code from `@terhal/contracts`, a status and
  a human detail. Clients switch on `code`, never on `detail`.
- Every error response is RFC 9457 problem details (`application/problem+json`) with the request id, which is also on
  every log line written while handling it. Validation failures are `400 VALIDATION_FAILED` with one `errors` entry per
  problem.
- Anything else thrown is a bug: logged in full, answered with a generic 500. An unreachable or overloaded database is a
  503, so clients retry.

## Auth

- Each audience (customer site, staff dashboard, admin panel) has its own origin, its own session cookies and its own
  JWT secret, so a token from one can never be used as another. The API accepts each audience's routes only from its
  own origin (CORS plus an Origin check on unsafe methods), so a bug on the customer site can't act through an admin's
  session.
- Auth cookies are httpOnly, Secure, SameSite=Lax and host-only on the API. Each audience's cookies are scoped to its
  prefix (`/v1/admin`, `/v1/staff`, `/v1/site`), and the refresh token (and the admin's sign in challenge) only reach
  `<prefix>/auth`.
- An access token names its session (`sid`), and every signed in request loads that session and its account in one
  query. Signing out, revoking a session, resetting a password, a deactivation or a permission change take effect on the
  next request, not when the token expires.
- Admins sign in with a password and then a TOTP code; the access token lives 15 minutes, a session at most 12 hours,
  and every request re-checks the admin is still active.
- Staff sign in with a password only. A session lasts 7 days from its last refresh and 30 days at most, on up to 5
  devices; every request re-checks the staff member is active and reloads their permissions. Resetting a password ends
  every session.
- Customers sign up with a password and confirm their email with a 6-digit code before their first session. A session
  lasts 30 days from its last refresh and 180 days at most, on up to 10 devices. They sign in with their email or phone.
- Guests book without an account: a session cookie (30 days, never extended) that's only usable once they confirm the
  code emailed to them.
- Everything security relevant is written to the audit log, in the same transaction as the change it records.

## Failure handling

| Concern  | Rule |
| -------- | ---- |
| Config   | `platform/config/env.ts` validates every variable at startup with zod. A missing secret or URL stops the process instead of running insecurely. |
| Timeouts | Requests get a 503 after 15 seconds. Every outbound call must have a timeout. |
| Health   | `/health/live` checks only that the process is up. `/health/ready` drives the deploy's healthcheck: it fails while shutting down or when Postgres is unreachable; Redis is reported as `degraded`. |
| Shutdown | On `SIGTERM` the API fails readiness, stops accepting connections, finishes in-flight requests, then closes Prisma and Redis, inside the container's `stop_grace_period`. The worker stops taking jobs and finishes its current ones. |
| Jobs     | Processors must be idempotent (BullMQ runs jobs at least once): give jobs deterministic ids, retry with backoff. |
| Redis down | Rate limits on sign in fail closed: an unreachable Redis must not mean unlimited password guesses. |
| Client IPs | Rate limits trust only the header named by `CLIENT_IP_HEADER`, which the edge Caddy overwrites. Never publish the server's port. |
| Neon     | `DATABASE_URL` is the pooled URL (PgBouncer, transaction mode), so no session state: no session advisory locks. Migrations use the direct URL. The API and the database must be in the same region. |
| Migrations | Expand and contract once the client's data is in production (see [Migrations](#migrations)): a deploy never breaks the code that's still running. They run in their own container before the new version starts (`deploy/deploy.sh`), never at boot. |
| Rollback | Because migrations stay backward compatible, a rollback is a redeploy of the previous images (README, "Deploys"). |

## Migrations

- **One migration per domain**, named after it and applied in dependency order: `20261022010000_admin`,
  `…030000_locations`, `…040000_staff`, `…050000_customers`, `…060000_fleet`, `…070000_trips`, `…080000_pricing`,
  `…090000_notifications`, `…100000_analytics`. Models live in the matching file under `prisma/schema/`.
- **Everything a domain's tables need lives in its migration:** tables, indexes and foreign keys as Prisma generates them,
  then the rules Prisma can't express (CHECK constraints, triggers) at the end, each with a comment saying why. They're
  named `<Table>_<rule>`, e.g. `Trip_one_booker` or `Location_shape`. No add-on migrations that only add a constraint.
- **Until the client's data is in production, a schema change is folded into its domain's migration**, not added as a new
  one. `prisma migrate deploy` never re-runs a migration it has already applied, so after editing one, staging and
  production have to be wiped before the next deploy (track it under Open items in [infrastructure.md](infrastructure.md)).
  Once the client's data is live this stops: every change is a new migration, expand and contract.
- **Check for drift** after every schema change: apply the migrations to an empty database, then
  `prisma migrate diff --from-config-datasource --to-schema prisma/schema --script` must print an empty migration.

## Tests

- `pnpm test` runs Vitest against real Postgres and Redis started by testcontainers (Docker required), never mocks,
  because the invariants live in the database. Each worker gets its own copy of a migrated template database and its own
  Redis database, so files run in parallel.
- Tests go through HTTP where they can (`test/support/http.ts` keeps cookies like a browser), so they exercise
  validation, auth, rate limits and serialization too.

## Adding a module

1. Schemas first: requests and responses in `packages/contracts/src/<module>.ts`, exported from its `index.ts`.
2. `apps/server/src/modules/<module>/`: `domain/` for rules, `application/` for use cases, `http/routes.ts` for routes,
   and an `index.ts` that exports only what other modules and the router need.
3. Mount its routes in `src/http/router.ts` (chained onto `v1`).
4. Regenerate the contract (`pnpm --filter @terhal/server test -u`), and add tests next to the others.
