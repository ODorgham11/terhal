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
    analytics/      the dashboard's figures, CSV exports and the monthly XLSX report (reads other modules' tables)
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
  - The web app calls the API through `hc<AppType>` (`apps/web/lib/api`), e.g. `api.v1.admin.auth.session.$get()`.
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
- After the first (seeded) admin, every admin is invited by another. Actions that matter most (inviting an admin,
  changing a password, deactivating an admin, resetting their two-factor) ask for the acting admin's current TOTP code
  again, used up like a sign in code so it can't be replayed; failures are audited. A forgotten password is reset with
  an emailed link (15 minutes, single use) plus a current TOTP code, and ends every session; changing it while signed
  in ends every other session. An admin can list and end their own sessions.
- Admins manage each other: nobody can deactivate themselves, and the last active admin can't be deactivated (the
  active admins' rows are locked, so two admins deactivating each other at once can't leave none). An admin who lost
  their authenticator has it reset by another admin: their sessions end and they're emailed a link (48 hours) to set up
  a new one, confirmed with their password and a code from it, which signs them in.
- Staff sign in with a password only. A session lasts 7 days from its last refresh and 30 days at most, on up to 5
  devices; every request re-checks the staff member is active and reloads their permissions. Resetting a password ends
  every session.
- Customers sign up with a password and confirm their email with a 6-digit code before their first session. A session
  lasts 30 days from its last refresh and 180 days at most, on up to 10 devices. They sign in with their email or phone.
- Drivers have no accounts either: a trip's report link (`terhal.co/report#<token>`) is their credential for that trip
  alone. The page sends the token in a `Report-Token` header to `/v1/site/driver/report` (no cookie), limited per IP;
  the token is a keyed HMAC, so the database holds only its hash and a salt, and it stops working when the driver
  changes, staff replace it, or 7 days after pickup.
- Guests book without an account: a session cookie (30 days, never extended) that's only usable once they confirm the
  code emailed to them.
- Everything security relevant is written to the audit log, in the same transaction as the change it records.

## Failure handling

| Concern  | Rule |
| -------- | ---- |
| Config   | `platform/config/env.ts` validates every variable at startup with zod. A missing secret or URL stops the process instead of running insecurely. |
| Timeouts | Requests get a 503 after 15 seconds. Every outbound call must have a timeout. |
| Health   | `/health/live` checks only that the process is up. `/health/live` is the container's healthcheck (deploy/compose.yml); it never touches Postgres, so Neon can scale to zero. `/health/ready` is checked once per deploy, from outside: it fails while shutting down or when Postgres is unreachable; Redis is reported as `degraded`. |
| Shutdown | On `SIGTERM` the API fails readiness, stops accepting connections, finishes in-flight requests, then closes Prisma and Redis, inside the container's `stop_grace_period`. The worker stops taking jobs and finishes its current ones. |
| Jobs     | Processors must be idempotent (BullMQ runs jobs at least once): give jobs deterministic ids, retry with backoff. Each module with jobs has its own queue (`trips`, `analytics`, `notifications`); schedules are BullMQ job schedulers named after their job, upserted on every worker start, and a cron in business time takes `tz: "Africa/Cairo"`. Never queue a job from inside a transaction: write an outbox row in it, and let a scheduled sweep queue it once committed (notifications' `sweep-notifications`, every 5 seconds). Scheduled jobs that poll Postgres go through the job gate (`platform/jobs/gate.ts`): the change marks a Redis signal inside its transaction, and the job queries only after a change, when it said it's due, or on the hour, so Neon can scale to zero while nothing happens. Delayed jobs (reminders) only wake the worker; the row they belong to says whether they're still due. |
| Redis down | Rate limits on sign in fail closed: an unreachable Redis must not mean unlimited password guesses. |
| Client IPs | Rate limits trust only the header named by `CLIENT_IP_HEADER`, which the edge Caddy overwrites. Never publish the server's port. |
| Neon     | `DATABASE_URL` is the pooled URL (PgBouncer, transaction mode), so no session state: no session advisory locks. Migrations use the direct URL. The API and the database must be in the same region. |
| Migrations | Expand and contract once the client's data is in production (see [Migrations](#migrations)): a deploy never breaks the code that's still running. They run in their own container before the new version starts (`deploy/deploy.sh`), never at boot. |
| Rollback | Because migrations stay backward compatible, a rollback is a redeploy of the previous images (README, "Deploys"). |

## Migrations

- **One migration per domain**, named after it and applied in dependency order: `20261022010000_admin`,
  `…030000_locations`, `…040000_staff`, `…050000_customers`, `…060000_fleet`, `…070000_trips`, `…080000_pricing`,
  `…090000_notifications`, `…100000_analytics`. Models live in the matching file under `prisma/schema/`. Brands came
  later as their own migration, `20261127000000_brands`, which also adds `Trip.brandId`: staging and production had
  already applied the trips migration, so it couldn't be folded in.
- **Everything a domain's tables need lives in its migration:** tables, indexes and foreign keys as Prisma generates them,
  then the rules Prisma can't express (CHECK constraints, triggers) at the end, each with a comment saying why. They're
  named `<Table>_<rule>`, e.g. `Trip_one_booker` or `Location_shape`. No add-on migrations that only add a constraint.
- **Until the client's data is in production, a schema change is folded into its domain's migration**, not added as a new
  one. `prisma migrate deploy` never re-runs a migration it has already applied, so after editing one, staging and
  production have to be wiped before the next deploy (track it under Open items in [infrastructure.md](infrastructure.md)).
  Once the client's data is live this stops: every change is a new migration, expand and contract.
- **Check for drift** after every schema change: apply the migrations to an empty database, then
  `prisma migrate diff --from-config-datasource --to-schema prisma/schema --script` must print an empty migration.

## Web app

`apps/web` is one Next.js app serving three hosts. `proxy.ts` rewrites each host onto its section (`app/site`,
`app/staff`, `app/admin`), and each section's `layout.tsx` wraps its pages in that host's providers and a bare shell
(`components/AppShell.tsx`: the host's name and the locale switcher).

```
apps/web/
  app/            the root layout (fonts, <html lang dir>, next-intl) and one folder per host
  components/
    ui/           the UI kit
    session/      RequireAdmin, RequireStaff, RequireCustomer, RequireGuest
    providers/    QueryProvider and each host's providers
  i18n/           locales, the request config that reads the locale cookie
  lib/
    api/          the RPC client, refresh-and-retry, ApiError, error messages
    forms/        useZodForm, localized validation messages
    session/      session hooks, sign-in routes, sign out
  messages/       ar.json and en.json
  eslint/         the logical-classes rule
```

### Localization and direction

- **Arabic is the default, English the other.** The locale is the `NEXT_LOCALE` cookie, not a URL prefix: next-intl runs
  without its routing, and `i18n/request.ts` reads the cookie on every request. The root layout sets `<html lang dir>`
  from it (`dir="rtl"` for Arabic).
- **The locale switcher** (`components/LocaleSwitcher.tsx`) writes the cookie in the browser and calls
  `router.refresh()`, so it works the same on every host. The cookie is host-only: each host remembers its own choice.
- **Messages** live in `messages/{ar,en}.json`, one namespace per area: `common` (shared words, field names, the UI kit's
  own text), `errors` (API error codes and validation), `site`, `staff`, `admin`. Keys are typed from `en.json`
  (`global.d.ts`), so a misspelled key fails the type check, and `messages/check.ts` fails it when one language has a key
  the other doesn't.
- **Use them** with `useTranslations("staff")` in client components and `await getTranslations("staff")` in server
  ones. Dates and numbers go through next-intl's `useFormatter()` (time zone `Africa/Cairo`).
- **The font** is IBM Plex Sans Arabic for both languages (`next/font`, self-hosted).
- **Logical CSS only.** Use `ms-/me-/ps-/pe-/start-/end-/text-start/text-end/rounded-s/border-e`, never
  `ml-/mr-/pl-/pr-/left-/right-/text-left/text-right/rounded-l/border-r`, and `gap` instead of `space-x-`. `pnpm lint`
  fails on a physical class anywhere in the app's TypeScript (`eslint/logical-classes.mjs`). For the rare thing that has
  to move along the x axis (a switch's thumb, a slide-in), pair `ltr:` and `rtl:` variants.
- Text that must stay left to right inside Arabic (codes, phone numbers, emails, plates) gets `dir="ltr"`.

### Icons

Tabler (`@tabler/icons-react`), imported one by one. An icon that points along the reading direction (next, back, a
chevron on a link) goes through `DirectionalIcon`, which mirrors it in Arabic. Pick it as it reads in English:

```tsx
<DirectionalIcon icon={IconChevronRight} className="size-4" />   // "next": points left in Arabic
```

Icons with a real direction (north, sort order, undo) and every other icon are used as they are. Decorative icons get
`aria-hidden`; the button around them carries the label.

### The UI kit

`components/ui/` is built on Radix (the `radix-ui` package) where behavior is hard to get right (Dialog, Drawer,
DropdownMenu, Tabs, Toast) and on native elements everywhere else (Select, Checkbox, Radio, Switch), so
`register("field")` works on them as is. Colors are theme tokens (`bg-surface`, `text-muted`, `border-border`,
`bg-primary`...) defined as CSS variables in `app/globals.css`, with a dark theme that follows the system. Never use raw
palette colors (`bg-neutral-100`) in pages.

| Component | Use |
| --- | --- |
| `Button` | `variant` primary, secondary, ghost, danger, link; `size` sm, md, lg, icon; `loading`; `asChild` to style a `<Link>` |
| `Field` | label, `hint`, `error`; any control inside gets the id and aria attributes |
| `Input`, `Textarea`, `Select`, `PhoneInput` | text-like controls; `Input` takes `startAdornment`/`endAdornment` |
| `Checkbox`, `RadioGroup` + `Radio`, `Switch` | carry their own label |
| `CodeInput` | the 6-digit code, controlled (`value`, `onChange`, `onComplete`); digits stay left to right |
| `Form`, `FormField`, `FormError` | react-hook-form wiring (see Forms) |
| `Card` (+ `CardHeader`, `CardContent`, `CardFooter`), `PageHeader`, `EmptyState` | page structure |
| `Dialog`, `Drawer`, `DropdownMenu`, `Tabs` | Radix underneath; the Drawer slides in from the inline end |
| `Table` (+ `TableEmpty`, `TableLoading`), `Pagination` + `useCursorPages` | lists, paged by the API's `nextCursor` |
| `Badge`, `Alert`, `toast` + `Toaster`, `Spinner`, `Skeleton`, `QrCode` | status and feedback |

Each file starts with an example. Components take translated text from the page; the few words of their own (Close,
Next, Loading) are under `common.ui`.

### Calling the API

`lib/api` wraps the Hono RPC client (`hc<AppType>`) with `credentials: "include"`. Use the client for the page's host:
`adminApi`, `staffApi` or `siteApi`. `call()` returns the typed body of a success, or throws an `ApiError` carrying
`code`, `status`, the validation `errors` and the `requestId`:

```tsx
const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => call(adminApi.auth.sessions.$get()) });
const errorMessage = useErrorMessage();
// ...
toast.error(errorMessage(error));   // every ErrorCode has a message in both languages (errors.codes)
```

- **Refresh and retry.** On a 401 `ACCESS_TOKEN_EXPIRED`, the client calls that audience's `…/auth/refresh` once and
  replays the request. Requests that expire together share one refresh (the API rotates the refresh token, so racing
  refreshes would fail). A refused refresh reports the audience signed out (`onSignedOut`), which the host's providers
  turn into a signed-out session; an unreachable API is not signed out.
- A failure that never got an answer is `NETWORK_ERROR`; a non-problem response (a proxy's 502) is
  `UNEXPECTED_RESPONSE`. TanStack Query retries those and 5xx once, never a 4xx.

### Forms

`useZodForm(schema, options)` is react-hook-form validating against a `@terhal/contracts` schema; `onSubmit` gets the
schema's output (trimmed, normalized), exactly what the API takes. `<Form>` turns a thrown `ApiError` into field errors
(for `VALIDATION_FAILED`) or a form error shown by `<FormError>`:

```tsx
const fields = useTranslations("common.fields");
const form = useZodForm(StaffSignIn, { defaultValues: { email: "", password: "" } });

<Form form={form} onSubmit={(json) => call(staffApi.auth["sign-in"].$post({ json })).then(() => router.replace("/"))}>
  <FormError />
  <FormField name="email" label={fields("email")}>
    <Input type="email" autoComplete="email" {...form.register("email")} />
  </FormField>
  <Button type="submit" loading={form.formState.isSubmitting}>{t("signIn")}</Button>
</Form>
```

**Validation messages are rebuilt, not translated.** The contracts' zod messages are English, and a message set on a
schema wins over any zod error map. So `lib/forms/issues.ts` ignores the message and builds one from the issue: its code
(`invalid_type` is required, `too_small` with its `minimum`, `invalid_format` with its `format` or regex `pattern`), and
the field's name from `common.fields`. The API's `VALIDATION_FAILED` issues go through the same function. When a
contract gains a field, add its name to `common.fields`; when it gains a regex, add the pattern to `issues.ts` (until
then it reads "{field} isn't valid.").

### Sessions

Auth cookies are httpOnly and host-only on the API, so the Next server can't see them: sessions are checked in the
browser, through each audience's session route, cached by TanStack Query.

- `useAdminSession()`, `useStaffSession()`, `useCustomerSession()`, `useGuest()` return
  `{ status: "loading" | "signed-in" | "signed-out" | "unverified" | "error" }`, with `user` once signed in.
- Guards render their children only for a signed-in user and send everyone else to the host's sign-in route
  (`lib/session/routes.ts`) with `?next=` (read it back with `safeNext`):

  ```tsx
  <RequireStaff permission="team">{(staff) => <TeamPage me={staff} />}</RequireStaff>
  ```

  They decide what the page shows, not who may do what: the API checks every request.
- `useSignOut("admin")` ends the session on the API, drops every cached query and goes to sign in.

### Adding a page

1. Create it under the host's folder: `app/staff/trips/page.tsx` is `dashboard.terhal.co/trips`. Links are written as
   the browser sees them (`/trips`), never with the section.
2. Add its strings to both `messages/en.json` and `messages/ar.json`, under the host's namespace.
3. If it needs a signed-in user, wrap its content in the host's guard (in the page, or in a `layout.tsx` for a group of
   pages; the sign-in pages stay outside it).
4. Fetch with `useQuery` + `call()`, write with `useMutation` or `<Form>`, and show failures with `useErrorMessage()`.
5. Build it from `components/ui`; check it in both languages.

The rules: **logical CSS only**, and **every user-visible string goes through messages, in both languages**, including
`aria-label`s, placeholders and toasts.

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
