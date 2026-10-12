# Terhal — project guide for AI coding assistants

Booking platform and admin dashboard for an **already-operating** intercity
limousine business in Alexandria, Egypt (real customers today). It formalizes
their existing process; it doesn't invent a new one.

**Read before any non-trivial change:**
- `docs/master-doc.md` — business rules, data model, open decisions, schema gaps
- `docs/infra-architecture.md` — hosting, CI/CD, environment variables, known pitfalls

If this file and the docs disagree, the docs win; point out the conflict.

## Repo layout

```
.github/workflows/  ci.yml (PR checks), migrate.yml (production migrations)
backend/            Hono API (TypeScript, ESM, Prisma 7)
  api/index.ts        Vercel entry point — getRequestListener(app.fetch)
  src/app.ts          the Hono app: middleware, routes, error handler
  src/index.ts        LOCAL DEV ONLY — serve() on port 8080
  src/domains/<x>/    per-domain routes / handlers / service / validators
  src/shared/         middleware (zod validate), utils (errors, prisma client)
  prisma/schema/      schema split per domain (*.prisma)
  prisma/migrations/  applied migrations — never edit these
  public/.gitkeep     required by Vercel, keep it
  vercel.json         rewrites all paths to /api
frontend/           Next.js 16 app router (see frontend/AGENTS.md)
localstack/         local S3 emulation for docker-compose (dev only)
docs/               project documentation
```

## Commands

Backend (`cd backend`):
- `npm install` — also runs `prisma generate` (postinstall)
- `npm run dev` — local server on http://localhost:8080 (tsx watch)
- `npm run build` — `tsc` type check + compile to `dist/`
- `npm start` — run compiled server (`node dist/src/index.js`)
- `npx prisma validate` — check the schema
- `npm run db:migrate -- --name <name>` — create a migration, **local DB only**
- `npm run db:seed` — email the first staff/admin invitations (`STAFF_EMAIL`, `ADMIN_EMAIL`)
- `npm run db:reset` — wipe and re-migrate the **local** DB (refuses non-local hosts)

Frontend (`cd frontend`):
- `npm run dev`, `npm run lint`, `npm run build`
- `npx next typegen && npx tsc --noEmit` — type check (typegen first, route types are generated)

Local database: `docker compose up` from the repo root (Postgres + LocalStack),
configured by `.env` (copy from `.env.example`). The backend loads `.env`
from `backend/`, so when running it outside Docker set `DATABASE_URL` in the
shell. Never point local work at the Neon databases.

## Rules

**Workflow**
- `main` is protected: every change goes through a branch and a pull request,
  and the **Frontend** and **Backend** CI checks must pass. Never push to `main`.
- Merging to `main` auto-deploys both apps to production on Vercel.
- Don't commit `.env`, `dist/`, `generated/`, or anything with credentials.

**Business rules** (details in `docs/master-doc.md`)
- Don't invent anything marked **OPEN** (Section 17): pricing numbers,
  non-Visa payment flows, auto-cancel cutoffs, the `/api` prefix.
- Don't silently resolve **SCHEMA GAPS** (Section 18) — ask first.
- **Admin vs Staff** (gap 10): `feature/auth` built both — Staff are
  invited `User`s with a `permissions` list, Admins are a separate table
  with mandatory TOTP. Which one the owner uses is still unconfirmed; don't
  build dashboards that assume an answer, and don't merge the two systems
  without the team deciding.
- The driver has **no trip-visibility screen** — only end-of-trip reports.
- **No `Branch` entity** — external cars/drivers only store a source company.
- The backend is authoritative for pricing, auth and business rules;
  frontend validation is convenience only.
- No hard deletes on `Trip`; cancelling is a status.

**Database**
- The schema is applied to production. Any change = a **new** migration.
  Never edit or delete an existing migration file.
- Never run `prisma migrate dev` or `migrate reset` against Neon.
  Production migrations run only via the `migrate.yml` workflow.
- Constraints Prisma can't express (e.g. `CHECK (num_nonnulls(...) = 1)`)
  go into the migration SQL by hand.

**Backend code**
- Relative imports with `.js` extensions (`./app.js`,
  `../../shared/utils/prisma.js`). No `@/` alias — it breaks the compiled
  build and Vercel.
- Keep `src/app.ts` free of side effects (no `serve()`, no port).
- Vercel entry stays `getRequestListener(app.fetch)` from
  `@hono/node-server`. **Never `hono/vercel`** — it hangs every request on
  Vercel's Node runtime.
- Validate request input with zod through `src/shared/middleware/validate.ts`;
  throw `AppError` subclasses from `src/shared/utils/error.ts` for expected
  errors. The error handler in `app.ts` shapes all error responses.
- `src/shared/utils/prisma.ts` throws if `DATABASE_URL` is missing — that's
  intentional. Other secrets (`APP_SECRET`, `ADMIN_SECRET`,
  `TOTP_ENCRYPTION_KEY`, `RESEND_KEY`) are read lazily, so the app boots
  without them and only the features using them fail.
- Rate-limit public and token-based routes with
  `src/shared/middleware/rateLimit.ts` (Postgres-backed).
- Send email/WhatsApp only through `domains/messaging/messaging.service.ts`.
  WhatsApp is a stub that throws in production until Meta is integrated.
- Auth cookies are `SameSite=Lax`: frontend and backend must share a site
  (custom domain). On the two `*.vercel.app` domains sign-in can't work.
- Never change `TOTP_ENCRYPTION_KEY` once admins exist.

**Frontend code**
- Next.js 16 differs from older versions; read `frontend/AGENTS.md` and
  the bundled docs in `node_modules/next/dist/docs/` before writing code.
- Use generated route types (`LayoutProps<"/">`, `PageProps<...>`).
- The backend URL comes from `NEXT_PUBLIC_API_URL`. Never put secrets in a
  `NEXT_PUBLIC_` variable.

**CI / workflows**
- `npm test` is a placeholder in both apps; replace it with real tests.
- Workflow files still use `actions/*@v4` and Node 20; bump to `@v5` / Node 22
  when editing them.

## Deployment facts

- Frontend: https://terhal-frontend.vercel.app (Vercel project `terhal-frontend`)
- Backend: https://terhal-backend-fawn.vercel.app (Vercel project `terhal-backend`)
  — health checks at `/health` and `/health/process`
- Database: Neon, Frankfurt — branch `production` (Vercel Production) and
  `development` (Vercel Preview)
- All functions run in Vercel region `fra1`
