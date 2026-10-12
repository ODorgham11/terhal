# Task file: Gap 10 (option a) + Staff dashboard — branch `feature/dashboard`

Written 2026-10-12. Hand this file to Claude Code from the repo root
(`D:\terhal\terhal`) and work through it phase by phase. Tick boxes as you go.

---

## 0. Ground rules (read first, follow throughout)

- **Never touch `main`.** No commits, no pushes, no merges, no PRs into `main`.
  All work lives on `feature/dashboard`. If you need sub-branches, branch off
  `feature/dashboard` and merge back into it.
- Read `CLAUDE.md`, `docs/master-doc.md`, `docs/infra-architecture.md`, and
  `frontend/AGENTS.md` before writing code. If they disagree with this file,
  stop and say so.
- **Local only.** Use `docker compose up` (Postgres + LocalStack). Never point
  anything at Neon. Never run `prisma migrate dev` / `migrate reset` against Neon.
- **Schema changes = new migrations.** Never edit or delete a file in
  `backend/prisma/migrations/`.
- Backend imports are relative with `.js` extensions. No `@/` alias in backend.
- Keep `src/app.ts` free of side effects. Never use `hono/vercel`.
- Don't invent anything marked OPEN (master-doc §17) or silently resolve other
  schema gaps (§18). Ask instead.
- After every phase: `cd backend && npm run build` and
  `cd frontend && npx next typegen && npx tsc --noEmit && npm run lint` must pass.
  Commit at the end of each phase with a clear message.

### Decision being implemented (team-confirmed at the last meeting)

Gap 10 → **option (a)**: delete the separate `Admin` login system. The owner is a
`Staff` member with `permissions: ["*"]`. **Two-factor (TOTP) is mandatory for
every staff member whose permissions include `"*"`**, and not used for
anyone else. `AuditLog` points at `Staff`.

---

## Phase 1 — Branch setup

- [ ] `git status` is clean, apart from the untracked `CLAUDE.md`, `docs/`, and
      this task file. Confirm `.env` is git-ignored and never staged.
- [ ] `git switch main && git pull` (read-only update, nothing is committed to main)
- [ ] `git switch -c feature/dashboard`
- [ ] Commit the docs first:
      `git add CLAUDE.md docs/` → `git commit -m "docs: add project guide, master doc, infra architecture, dashboard task file"`
- [ ] `cd backend && npm install`, `cd ../frontend && npm install`
- [ ] `docker compose up -d`, then `cd backend && npm run db:reset -- --force`
      so the local DB matches all 9 existing migrations.
- [ ] Baseline check: both builds pass before any change.

---

## Phase 2 — Schema + migration (gap 10)

### 2.1 Prisma schema edits

`backend/prisma/schema/admin.prisma` → delete `AdminStatus`, `Admin`,
`AdminInvitation`, `AdminSession`. Keep `AuditLog` but change its actor:

```prisma
model AuditLog {
  id String @id @default(cuid())

  // Who did it. Empty for the system (the seed) and for failed sign-ins on unknown emails.
  staff   Staff?  @relation(fields: [staffId], references: [id])
  staffId String?

  action     String
  entityType String
  entityId   String
  before     Json?
  after      Json?
  ipAddress  String?
  createdAt  DateTime @default(now())

  @@index([entityType, entityId])
}
```

Rename the file to `audit.prisma` (only schema files, not migrations).

`backend/prisma/schema/auth.prisma`:

```prisma
model Staff {
  // ...existing fields...
  // Two-factor, required for full-access ("*") staff. totpEnabledAt is null while setup is pending.
  totpSecret       String?   // encrypted with TOTP_ENCRYPTION_KEY (shared/utils/encryption.ts)
  totpEnabledAt    DateTime?
  totpLastUsedStep Int?
  auditLogs        AuditLog[]
}

model UserSession {
  // ...existing fields...
  // Set when the session was started with a verified 2FA code. Full-access staff sessions without it are refused on refresh.
  twoFactorVerifiedAt DateTime?
}
```

### 2.2 Migration

- [ ] `npm run db:migrate -- --create-only --name staff_two_factor`
- [ ] **Replace** the generated SQL with this (Prisma would drop/re-add the
      column instead of renaming it):

```sql
-- Refuse to run if any admin account exists, so a real account is never deleted silently.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Admin") OR EXISTS (SELECT 1 FROM "AdminInvitation") OR EXISTS (SELECT 1 FROM "AdminSession") THEN
    RAISE EXCEPTION 'Admin tables are not empty. Move those accounts to Staff by hand before applying this migration.';
  END IF;
END $$;

-- AuditLog now points at Staff. Existing rows can only have a NULL adminId (the Admin table is empty).
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_adminId_fkey";
ALTER TABLE "AuditLog" RENAME COLUMN "adminId" TO "staffId";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP TABLE "AdminSession";
DROP TABLE "AdminInvitation";
DROP TABLE "Admin";
DROP TYPE "AdminStatus";

ALTER TABLE "Staff"
  ADD COLUMN "totpSecret" TEXT,
  ADD COLUMN "totpEnabledAt" TIMESTAMP(3),
  ADD COLUMN "totpLastUsedStep" INTEGER;

ALTER TABLE "UserSession" ADD COLUMN "twoFactorVerifiedAt" TIMESTAMP(3);
```

- [ ] `npx prisma validate`, then `npm run db:migrate` (local) applies it.
- [ ] `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema --script`
      outputs nothing (schema and migrations agree). If it shows a diff, fix the
      SQL (e.g. constraint names), never the old migrations.

---

## Phase 3 — Backend auth refactor

### 3.1 Delete
- [ ] `src/domains/admin/` (all 5 files) and its `.route('/admin', admin)` + import in `src/app.ts`.

### 3.2 `src/domains/token/token.service.ts`
- [ ] Remove the `admin` audience (config entry, `AudienceClaims.admin`). `Audience` becomes `"user"` only; keep the parameter so call sites don't churn.
- [ ] Challenge cookie moves to the user side: name `challenge`, audience `"user-challenge"`, signed with `APP_SECRET`, path `/auth`, 5-minute life. Keep `setChallengeCookie`, `verifyChallengeCookie`, `peekChallengeCookie`, `clearChallengeCookie` with a `userId` subject.
- [ ] Update the cookie comment to match reality (production is `SameSite=None; Partitioned`, see Phase 6).

### 3.3 `src/domains/audit/audit.service.ts`
- [ ] `adminId` → `staffId`. Rename action prefixes from `admin.*` to `staff.*`, add `STAFF_INVITATION_SENT`, `STAFF_INVITATION_ACCEPTED`, `TOTP_ENABLED`, `SIGN_IN_PASSWORD_FAILED`, `SIGN_IN_TOTP_FAILED`, `SIGN_IN_SUCCEEDED`, `SESSION_REVOKED`, `SIGN_OUT`.
- [ ] Audit **staff** events only. Customer sign-ins are not audited.

### 3.4 Shared helper
- [ ] Add `StaffService.requiresTwoFactor(permissions: string[]) => permissions.includes("*")` (single source of truth; later finer roles can extend it).

### 3.5 `src/domains/auth/auth.service.ts` — sign-in
Change `signIn` so that, after the password + status checks:
- If the user is `STAFF` and `requiresTwoFactor(staff.permissions)`:
  - do **not** create a session; return `{ twoFactorRequired: true, setupRequired: staff.totpEnabledAt === null, userId }`.
  - Audit `SIGN_IN_PASSWORD_FAILED` on wrong passwords for staff accounts (existing customers unaffected).
- Otherwise behave exactly as today.
- Split session creation into `createSession(user, { twoFactorVerified: boolean }, ip, ua)` so both paths reuse it. Set `UserSession.twoFactorVerifiedAt` when verified.
- Full-access sessions get a **12-hour absolute lifetime** (what `Admin` had) and a max of **3** active sessions; everyone else keeps 30 days / 5.

### 3.6 New 2FA methods (port from the deleted `admin.service.ts`, keep its race-safety patterns)
- `startTwoFactorSetup(userId)` — only when `totpEnabledAt` is null. Reuse a pending secret if one exists, otherwise create one, store encrypted in `Staff.totpSecret`. Returns `{ uri, secret }`.
- `verifyTwoFactor(userId, code)` —
  - pending setup: verify against the pending secret, then set `totpEnabledAt`, `totpLastUsedStep`; audit `TOTP_ENABLED`.
  - enabled: verify with `verifyTotp(secret, code, lastUsedStep)`; record the step with the conditional `updateMany` (blocks reuse and double-submit); audit failures with reason `wrong_code` / `code_reused`.
  - on success: `createSession(..., { twoFactorVerified: true })`, audit `SIGN_IN_SUCCEEDED`.

### 3.7 `refresh` / `getSession`
- [ ] On refresh, if the user is full-access staff and `session.twoFactorVerifiedAt` is null → revoke the session, audit `SESSION_REVOKED` (reason `two_factor_required`), throw `ForbiddenError(..., TOTP_SETUP_REQUIRED)`. This covers someone being promoted to `"*"` while signed in.
- [ ] Enforce the 12-hour absolute lifetime for full-access sessions.

### 3.8 Routes / handlers (`auth.routes.ts`, `auth.handlers.ts`, `auth.validators.ts`)
- [ ] `POST /auth/sign-in` → when 2FA is needed: set the challenge cookie, respond `200 { success, data: { twoFactorRequired: true, setupRequired } }`, no auth cookies.
- [ ] `POST /auth/two-factor/setup` → requires a valid challenge cookie; returns `{ totp: { uri, secret } }`. Rate limit per IP + per challenge user.
- [ ] `POST /auth/two-factor/verify` `{ code }` (6 digits) → requires challenge; on success clears challenge, sets auth cookies, returns `{ user }`. Rate limits: 10/15 min per IP, 5/5 min per challenge user (same as the old admin verify).
- [ ] Expired/missing challenge → `UnauthorizedError(TOTP_CHALLENGE_INVALID)`.

### 3.9 Staff invitations (`staff.service.ts`, `staff.handlers.ts`)
- [ ] `inviteStaff`: audit `STAFF_INVITATION_SENT` (actor = invitor staff id, null from the seed).
- [ ] `acceptInvitation`: audit `STAFF_INVITATION_ACCEPTED` in the same transaction.
- [ ] Accept handler: if the new staff member's permissions include `"*"`, **don't** sign them in; set the challenge cookie and return `{ twoFactorRequired: true, setupRequired: true }` so they set up 2FA immediately. Others are signed in as today.

### 3.10 Messaging, seed, env
- [ ] `messaging.service.ts` `sendInvitation`: drop the `"admin"` role variant.
- [ ] `prisma/seed.ts`: remove the admin invite and `ADMIN_EMAIL`. Rename `STAFF_EMAIL` → `OWNER_EMAIL` (invited with `["*"]`); keep reading `STAFF_EMAIL` as a fallback for one release and log a deprecation line.
- [ ] `.env.example`: remove `ADMIN_SECRET`, `ADMIN_EMAIL`; add `OWNER_EMAIL`. `TOTP_ENCRYPTION_KEY` stays (now for staff).
- [ ] `grep -ri "admin" backend/src backend/prisma/seed.ts` → only intentional leftovers (none expected).

---

## Phase 4 — Frontend

- [ ] Delete `app/admin/`, `app/auth/(admin)/` (sign-in, invite/admin, layout).
- [ ] `lib/api.ts`: remove the `admin` audience; refresh is always `/auth/refresh`.
- [ ] Create `components/auth/two-factor-step.tsx`: reuses the QR/secret UI from the deleted admin invite page (`qrcode.react` is already a dependency). Props: `setupRequired`, `onVerified(user)`. Flow: if `setupRequired`, call `/auth/two-factor/setup`, show QR + key; always ask for the 6-digit code; call `/auth/two-factor/verify`. On `TOTP_CHALLENGE_INVALID`, send the user back to the password step with the message.
- [ ] `app/auth/(customer)/sign-in/page.tsx`: add a third step `"two-factor"` after `"password"` when the response has `twoFactorRequired`. Same slide animation.
- [ ] `app/auth/(customer)/invite/staff/page.tsx`: if accept returns `twoFactorRequired`, show the same two-factor step, then go to `/dashboard`.
- [ ] `components/auth/staff-gate.tsx`: on `TOTP_SETUP_REQUIRED` from session/refresh, send to `/auth/sign-in`.
- [ ] Use generated route types (`PageProps<...>`, `LayoutProps<...>`); read `node_modules/next/dist/docs/` for anything Next 16-specific.

---

## Phase 5 — Verify gap 10 locally (must all pass before Phase 7)

Set in `backend/.env` (local values only): `APP_SECRET`, `TOTP_ENCRYPTION_KEY`,
`FRONTEND_URL=http://localhost:3000`, `OWNER_EMAIL`. Without `RESEND_KEY`, check
how `providers/email.ts` behaves locally (it may log the link instead of sending);
if it throws, read the invitation link from the console or add a dev-only log,
never a production bypass.

- [ ] `npm run db:reset -- --force` then `npm run db:seed` → owner invitation created.
- [ ] Owner accepts invite → forced 2FA setup (QR shown) → code accepted → lands on `/dashboard`.
- [ ] Sign out, sign in: password → code step → dashboard. Same code twice → rejected (`code_reused`).
- [ ] Wait out / delete the challenge cookie → `TOTP_CHALLENGE_INVALID` → back to password step.
- [ ] Owner invites a normal staff member (`permissions: []`) → they sign in with **no** 2FA.
- [ ] Customer sign-up / sign-in / verify / password reset still work unchanged.
- [ ] Promote a signed-in staff user to `["*"]` in the DB → their next refresh is refused with `TOTP_SETUP_REQUIRED`.
- [ ] `AuditLog` rows exist for invite sent/accepted, TOTP enabled, sign-in success/failures, sign-out — all with `staffId`.
- [ ] Both builds + lint + type check pass. Commit: `feat(auth): replace Admin with full-access Staff + mandatory TOTP (gap 10, option a)`.

---

## Phase 6 — Docs + infrastructure notes (same branch)

- [ ] `docs/master-doc.md`:
  - §2.1: owner = Staff with `["*"]` + mandatory TOTP; remove the "As built on feature/auth" box.
  - §10: remove the `Admin / AdminInvitation / AdminSession` entry; `AuditLog` → `staffId`; Staff gains TOTP fields; UserSession gains `twoFactorVerifiedAt`.
  - §18 item 10: mark **RESOLVED 2026-10-12 — option (a)**, with a one-line summary. Owner's admin actions on trips go into `TripEvent` as Staff, which was the original blocker.
- [ ] `docs/infra-architecture.md`:
  - §3.10 cookies: production actually uses `SameSite=None; Secure; Partitioned` plus `requireOrigin` (changed in the Oct 3 CORS commit). Note that `vercel.app` sign-in **may** work now; still recommend the custom domain and going back to `Lax`.
  - §4 env vars: remove `ADMIN_SECRET`; `TOTP_ENCRYPTION_KEY` now protects staff 2FA (still never rotate once set); `OWNER_EMAIL` replaces `STAFF_EMAIL`/`ADMIN_EMAIL` for the seed.
  - §7 open items: remove the Admin vs Staff item; update the production-accounts checklist (admin steps → owner 2FA steps).
- [ ] `CLAUDE.md`: replace the "Admin vs Staff (gap 10)" rule with the decision; remove `ADMIN_SECRET` from the secrets list; `db:seed` description → owner invitation.
- [ ] CI/workflows (CLAUDE.md asks for this when editing them): bump `actions/*@v4` → `@v5`, Node 20 → 22 in `ci.yml` and `migrate.yml`. **Don't change the triggers.** `migrate.yml` must still only run for `main`.
- [ ] Replace placeholder `npm test` in backend with a real runner (suggest `vitest`) and at least: `verifyTotp` reuse rejection, `requiresTwoFactor`, and the encryption round-trip. Make `ci.yml` run it.
- [ ] Commit: `docs+ci: record gap 10 decision, update infra notes, bump actions`.

---

## Phase 7 — Dashboard foundation

### 7.1 Safe schema items already agreed in the docs (new migration)
- [ ] Gap 9: `@@index([status, pickupDate])` on `Trip`.
- [ ] Gap 11: `CHECK (num_nonnulls("customerId", "guestSessionId") = 1)` on `Trip`, written by hand in the migration SQL.
- [ ] `npm run db:migrate -- --name trip_dashboard_index_and_owner_check` (local), then the same `migrate diff` check as Phase 2.

### 7.2 Permissions
- [ ] Backend middleware `requirePermission(perm)` built on `authorize([STAFF], { isActive: true })` + `StaffService.getStaff`; `"*"` passes everything. Use it on every dashboard route.
- [ ] Owner-only features check `"*"`. Don't invent finer permission names yet; if a screen needs one, list it and ask.

### 7.3 Shell
- [ ] `/dashboard` layout: sidebar/topbar, signed-in user, sign out, nav items shown by permission (Trips, New booking, Customers; owner-only: Staff, Audit log).

---

## Phase 8 — Dashboard features (Staff scope, master-doc §2.2)

Each item = backend domain (`routes / handlers / service / validators`, zod via
`validate.ts`, `AppError`s) + frontend page. Every state change on a trip writes a
`TripEvent` with the acting `staffId`. No hard deletes on `Trip`; cancelling is a status.

- [ ] **8.1 Trip list:** nearest pickup first (uses the gap 9 index), filter by status/date, pagination.
- [ ] **8.2 Trip detail + assignment:** assign vehicle, driver, plate, exact pickup time. Driver gets **no** screen; assignment is communicated off-platform.
- [ ] **8.3 Manual (phone) booking:** staff create a trip for a customer; recognise returning customers by phone/email match. **Pricing:** OPEN (§17), so don't compute prices. Leave a clearly marked manual field or a blocked step and ask.
- [ ] **8.4 Customers (CRM):** list + search + per-customer trip history.
- [ ] **8.5 Owner-only: Staff management:** list staff, invite (with permissions), suspend. Promoting to `"*"` triggers 2FA on next sign-in (Phase 3.7).
- [ ] **8.6 Owner-only: Audit log viewer:** filter by staff, action, entity.

### Blocked, don't build yet (ask the team)
- Driver end-of-trip report review: needs **gap 6** (one report covering several trips).
- Pricing editor (`PriceRule`) and payment verification (`Payment`): not in the schema yet (gaps), and pricing numbers are OPEN.
- No `Branch` entity, ever. External cars/drivers only store a source company.

---

## Phase 9 — Hand-off (still nothing touches `main`)

- [ ] Push only the feature branch: `git push -u origin feature/dashboard`.
- [ ] Optional: Vercel will build a **Preview** for the branch against the Neon `development` branch. Previews currently call the production backend and the backend Preview has no `FRONTEND_URL`, so treat preview testing as limited until that's fixed (infra-architecture §7).
- [ ] Do **not** open a PR into `main`, and don't run `migrate.yml`. Merging is a separate decision with Ammar. Before it happens, set the auth secrets, Resend, and the custom domain (infra-architecture §7, in order).
- [ ] Final summary for Omar: what changed, what's verified, what's blocked and why.
