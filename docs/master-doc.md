# Limousine Transportation Platform — Master Documentation (v2, Expanded)

> **Status of this document**: This supersedes both the earlier AI-generated
> master doc and the shorter v2 summary. Everything marked **CONFIRMED**
> comes directly from decisions made with the business owner or the team.
> Everything marked **OPEN** is genuinely undecided. Everything marked
> **SCHEMA GAP** is a difference between this document and the current
> Prisma schema that still needs to be reconciled with your partner — see
> Section 18. Do not silently resolve these by guessing.
>
> **Last updated: 2026-10-02**, to match the `feature/auth` branch (auth,
> staff/admin invitations, password reset, rate limiting, first frontend
> pages). The schema lives in `backend/prisma/schema/*.prisma` (split per
> domain) and now has **9 migrations**: the first 6 were applied to
> production on 2026-09-26, the other 3 (`rate_limit`, `invitations`,
> `reset`) apply when `feature/auth` merges to `main`. Section 18 was
> re-checked against that schema. For hosting, CI/CD and environment
> details, see `infra-architecture.md`.

---

## 1. Business Context

This is **not** a greenfield startup idea — it is a digitization project for
an **already-operating limousine/intercity transport business** based in
Alexandria, Egypt, with real existing customers. The platform must formalize
the business's current real-world process, not invent a new one — the
driver report format in Section 9 is copied directly from what the business
already uses.

The business owns a small fleet (~4 cars) and can source additional
cars/drivers from its network ("external") when needed. There are **no
branches** — only a `sourceCompany`/`office` reference when a car or driver
comes from outside the owned fleet. Target: live-tested within **3 months**
of project start.

A real vendor price list (Grand Royal Group, Alexandria) was reviewed during
design as a **reference for shape only** — it confirmed that pricing in this
market is route-based (not distance-formula-based), tiered by vehicle class,
with standard surcharges for extra stops and extra waiting hours, VAT
excluded, and a minimum vehicle model-year floor. **Actual pricing numbers
for this business are still pending from the client** (Section 17).

---

## 2. Roles & Personas

### 2.1 Owner
Full platform access. Configures pricing (`PriceRule`), views all financial
reports and driver float reconciliations, manages staff accounts and
permissions, and can do everything Staff can do.

> **As built on `feature/auth` (needs team confirmation):** there are two
> separate sign-in systems. **Staff** are `User`s with `role = STAFF`,
> created only by invitation, with a `permissions` list (`["*"]` = full
> access, the only value checked so far). **Admins** are a separate
> `Admin` table with its own login, mandatory two-factor (TOTP), and
> invitation-only accounts. Which of the two the **owner** uses, and what
> an Admin can do that full-access Staff can't, isn't decided yet — see
> Section 18, item 10.

### 2.2 Staff (Operations)
Day-to-day operators. Can:
- View and assign trips (car, driver, plate, exact pickup time)
- Create manual reservations on a customer's behalf (phone bookings)
- Review driver end-of-trip reports and mark payments `VERIFIED` /
  `QUESTIONABLE`
- See the full customer list/CRM view and trip history

Cannot:
- Edit `PriceRule` (pricing configuration)
- View financial/revenue reports
- Manage other staff accounts or permissions

*(The permission model is intentionally an extensible `Json` field on
`Staff` rather than a hardcoded two-value enum, so finer-grained roles can
be added later without a schema migration — see Section 10.)*

### 2.3 Driver
**No login/dashboard visibility into trips at all.** Assignment details
(pickup address, customer contact, time) are communicated entirely
off-platform — by phone or WhatsApp from staff — this was an explicit
decision, not an oversight. The driver's **only** platform interaction is
submitting the end-of-trip report described in Section 9, after the fact.

### 2.4 Customer
Books via the public site. **No account or login is required to book** — a
`GuestSession` is created per booking, verified via a WhatsApp OTP (a
seriousness/anti-spam check, not authentication). A customer may optionally
create a full `User`/`Customer` account later — the UI invites this after
booking but never requires it. Returning customers/guests are recognized
automatically when phone or email matches an existing record.

---

## 3. Customer Booking Flow

1. **First name, last name, email**
2. **Pickup and destination** — Google Places autocomplete (confirmed
   choice, not a fixed city list). Selected place data is snapshotted
   (`pickupSnapshot`/`dropoffSnapshot` + lat/long) so it remains accurate
   even if the underlying place record changes later.
3. **Requested date & time of travel**
4. **Vehicle type (`car`)**: Sedan / SUV / Van / Mini-van
5. **Service class**: Economy / VIP (VIP uses separate Mercedes sedan/van
   vehicles, per the business's real fleet)
6. **Passenger count**, and **luggage counts** by size (small / medium /
   large)
7. **Optional**: expected extra wait-time (hours) and/or an additional stop
   — both priced into the quote upfront if the customer provides them
   (**SCHEMA GAP** — not yet on `Trip`, see Section 18)
8. **Price shown** — computed from the current `PriceRule` table (route ×
   vehicle × class), then frozen onto `Trip.totalPrice` at this moment so a
   later owner-side rate change never silently affects an already-quoted
   trip
9. **Trip-confirmation verification** — a WhatsApp OTP confirms this is a
   real, serious customer (not SMS, to avoid per-message cost). Cloudflare
   Turnstile also guards the form itself against bot/spam submissions
   before this step is even reached.
10. **Customer confirms** → `Trip` created with `status = PENDING`,
    `source = USER` → request visible to staff.

**Short-notice bookings** (e.g. only ~2 hours before pickup) are accepted —
best-effort, not guaranteed a car will be found in time; see the escalation
rule in Section 4.

---

## 4. Admin/Staff Flow

- Staff sees `PENDING` trips and manually assigns exact car, driver, and
  plate — normally up to **12 hours before pickup time**.
- **Escalation, not auto-cancellation**: as the assignment deadline
  approaches with nothing assigned, the system alerts the admin with
  increasing urgency. For short-notice bookings there is no meaningful
  12-hour runway, so escalation begins immediately rather than waiting for
  a deadline that's already effectively passed.
- **Manual reservations**: staff can create a `Trip` directly with
  `source = STAFF` and `staffId` set — this reuses the same creation logic
  and validation as the public form, just entered by an operator instead of
  the customer.
- Once `driverId`/`vehicleId` are assigned, **status moves to `CONFIRMED`**
  and a confirmation (car, driver, plate, price, exact time) is sent to the
  customer via WhatsApp **and** email in parallel.
- **Repeat-customer detection** happens at trip-creation time: if the
  phone/email on a new booking matches an existing `Customer` record, staff
  see a match prompt right there in the creation flow — not a separate
  lookup step done ahead of time.
- **Customer list / CRM view**: staff and owner can browse all customers
  and their trip history.
- **Audit log (`TripEvent`)**: every staff action against a trip (status
  change, reassignment, note) is logged with `staffId`, `action` (free
  text), and timestamp. There is no customer-authored audit entry —
  customers never act directly on the platform; anything a customer wants
  changed is always mediated by staff, who log it.

---

## 5. Reservation Lifecycle

```
PENDING ──(staff assigns car+driver)──▶ CONFIRMED ──▶ IN_PROGRESS
                                                          │
                                                          ▼
                                                  AWAITING_REPORT
                                                          │
                                                          ▼
                                                     COMPLETED

   PENDING or CONFIRMED ──(staff cancels, any reason)──▶ CANCELLED
```

Notes:
- Assignment (driver/vehicle presence) is tracked via nullable
  `driverId`/`vehicleId` on `Trip`, **not** as a separate status value — a
  trip can be `CONFIRMED` with no driver yet. This deliberately keeps
  "what stage is this trip at" and "has a resource been assigned"
  as two independent, orthogonal facts.
- There is currently **no automated `EXPIRED` status or deadline field** —
  a missed 12-hour assignment window escalates staff urgency (Section 4)
  rather than transitioning the trip automatically. If you want the system
  to eventually auto-cancel unassigned trips past some hard cutoff, that is
  an **OPEN** decision (Section 17), not yet built.

---

## 6. Pricing

- **`PriceRule`** (owner-editable): keyed by origin × destination × vehicle
  type × service class, storing one-way price, round-trip price, an
  extra-hour rate, and an extra-stop rate. Editable directly by the Owner
  in the dashboard — no code deployment needed — because fuel prices move
  daily.
- **Snapshotting**: the price shown and agreed at booking is written onto
  `Trip.totalPrice` at that moment. A later `PriceRule` update never
  retroactively changes an already-booked trip's price.
- **Round-trip mechanic**: driver drops the customer at the destination and
  waits up to a baseline included period (currently ~4 hours); beyond that,
  extra hours bill at the extra-hour rate. The customer may add one extra
  stop before returning to the original pickup city/garage, billed at the
  extra-stop rate.
- Extra hours/stops can be **requested upfront** at booking (priced into
  the initial quote) **and/or** determined day-of and reconciled afterward
  in the driver's report — both paths are supported. The driver's report is
  always the final source of truth for what actually happened, since
  wait-time and stops are often only known during the trip itself.

---

## 7. Payments

- **VIP trips**: a deposit is required upfront, **refundable** if the trip
  is cancelled.
- **All trips**: the remainder is settled **after** trip completion, via
  transfer (InstaPay, Vodafone Cash, Orange Cash, WePay, or Cashier for
  Visa — Cashier is already registered with the client) with the customer
  sending proof **off-platform** (e.g. a screenshot sent directly to staff
  over WhatsApp, never uploaded to the site), or cash handed to the driver.
- **Verification is manual**: staff review the proof they received
  off-platform and mark the payment `VERIFIED` or `QUESTIONABLE` (flagged
  for the owner's personal review) — there is no automated payment-proof
  upload/verification pipeline on the platform.
- **Cashier/Visa** is the only payment method with a real registered
  gateway integration confirmed so far. All others are currently
  manual/human-verified (**OPEN** — Section 17 — whether any get real API
  integrations later).

---

## 8. Notifications

- **`Notification`** — belongs to a `User` (for registered customers/staff)
  **or** a `GuestSession` (for guest bookings) — a delivery record is kept
  for both, so support staff can check delivery/read status regardless of
  whether the customer has an account.
- **`NotificationDelivery`** — one row per channel attempt for a
  notification, tracking `channel` (WhatsApp / Email / In-App),
  `status` (Pending / Sent / Delivered / Read / Failed),
  `recipient` (WhatsApp only), `providerId` (for matching inbound
  delivery-status webhooks back to this row), and timestamps for each
  state transition.
- **WhatsApp Business Cloud API** (Meta) — primary channel for
  trip-request notifications to admin and confirmations to customers.
  Pre-approved message templates are required for business-initiated
  messages; **this approval process should start immediately** given its
  real lead time, and can run fully in parallel with development.
- **Email** — sent in parallel with WhatsApp for confirmations, and is the
  primary channel for OTP delivery (to avoid per-message SMS cost).

---

## 9. Driver Module

The driver has **no trip-visibility screen whatsoever**. The only
driver-facing feature is submitting an end-of-trip report, matching the
business's real current process exactly:

- **Garage exit / garage entry times** for the vehicle
- **One or more trip legs** per report — a single report (one vehicle
  outing) can cover multiple separate trips. Each leg needs: a free-text
  description (e.g. "round trip to Cairo + 3 extra hours + 1 extra stop"),
  the amount collected for that leg, and an **optional reference to the
  actual `Trip`** it corresponds to, so staff can verify the driver is
  genuinely reporting on a real assigned trip (nullable, since some trips
  may still be arranged off-platform during rollout).
- **Float/custody (عهدة) reconciliation**: previous float carried over +
  new float (money collected this report) = total float; itemized
  expenses subtracted to give the net amount remaining, tied to a specific
  vehicle. Expense categories in the real report include: كرتات (boxes),
  بدل (allowance), بنزين (fuel), غسيل (car wash), نثريات (misc).
- Receipts and driver/vehicle documents (license, registration, insurance,
  with expiry tracked so the admin gets alerted before lapse) are stored in
  Cloudflare R2.

**⚠️ SCHEMA GAP**: the current `TripReport` model uses a mileage/stops
structure (`startMileage`/`endMileage`, `TripStop` with lat/long) instead
of the float/legs structure described above and confirmed as matching the
real report. See Section 18 for the specific restructuring needed.

---

## 10. Full Data Model

*(Reflects the current schema in `backend/prisma/schema/*.prisma` — files
`auth`, `admin`, `fleet`, `trip`, `notification`, `analytics` — as applied
to production. Gaps are flagged — see Section 18 for the reconciliation
list. Not every scalar field is repeated verbatim below; relationships and
business-meaningful fields are.)*

### Trip (core aggregate)
`id`, `code` (unique), `source` (USER/STAFF), `status`, `customerId?`,
`guestSessionId?`, `staffId?`, `driverId?`, `vehicleId?`, `report?` (1:1),
`events[]`, `clientName`, `clientPhone`, `pickupDate` (requested pickup
date/time), `class` (ECONOMY/VIP), `smallLuggage`, `mediumLuggage`,
`largeLuggage`, `passengers`, `car` (SEDAN/SUV/MINIVAN/VAN), `totalPrice`,
`notes?`, `pickupId`, `pickupSnapshot`, `pickupLatitude`,
`pickupLongitude`, `dropoffId`, `dropoffSnapshot`, `dropoffLatitude`,
`dropoffLongitude`, `previousTripId?` / `subsequentTrip` (round-trip
chaining).

*Exactly one of `customerId`/`guestSessionId` must be set — to be enforced
via a database-level `CHECK` constraint (Postgres `num_nonnulls()`), not
expressible in Prisma's schema language directly; it has to be added by
hand in a migration's SQL. **SCHEMA GAP**: not present in the current
migrations — see Section 18.*

### TripEvent (staff audit log)
`id`, `staffId` (required — every event is staff-authored), `tripId`,
`action` (free text), `createdAt`.

### TripReport / TripStop / TripExpense
Current structure — see Section 18 for the needed rework toward the
float/legs model.

### GuestSession
`id`, `firstName`, `lastName`, `phone`, `email`, `tokenHash` (unique),
`verificationHash?`, `verificationExpiresAt?`, `verificationAttempts`,
`verifiedAt?`, `expiresAt`, `revokedAt?`, `trips[]`, `notifications[]`.

### User / UserSession
Standard account model: `firstName`, `lastName`, `role` (CUSTOMER/STAFF),
`status` (UNVERIFIED/ACTIVE/SUSPENDED/DELETED), `phone` (unique), `email`
(unique), `passwordHash`, verification fields (method-aware —
`verificationMethod`/`verifiedVia`), `passwordResetHash?` (unique) /
`passwordResetExpiresAt?` (single-use reset link — a new request replaces
the old one), 1:1 to `Staff` or `Customer`. Public sign-up always creates a
`CUSTOMER`; staff accounts only come from an `Invitation`.

`UserSession` stores only a **hash** of the refresh token. Sessions slide
(7 days per refresh) but are capped at 30 days from sign-in; the oldest
sessions are revoked once a user exceeds the per-user session limit.

### Invitation (staff)
`email`, `tokenHash` (unique), `invitorId?` (Staff — **not** unique; empty
for the invitation the seed sends before any staff exists), `permissions?`
(Json), `expiresAt`, `acceptedAt?`, `revokedAt?`.

### RateLimit
`key` (id, e.g. `sign-in:ip:<hash>`), `count`, `resetAt` — fixed-window
request counters kept in Postgres. Expired rows are safe to delete
(`npm run db:clear`).

### Staff
1:1 with `User`, `permissions` (Json — extensible role model), `trips[]`
(assigned by), `events[]` (audit log entries authored), `invitations[]`
sent.

### Customer
1:1 with `User`, `trips[]`.

### Admin / AdminInvitation / AdminSession / AuditLog
**SCHEMA GAP — built, but the design question is still open.** A separate
`Admin` model (`status` ACTIVE/INACTIVE, own `passwordHash`, encrypted
`totpSecret`, `totpEnabledAt`, `totpLastUsedStep` to block code reuse,
`lastLoginAt`), its own `AdminInvitation` (`invitorId?` → Admin; holds the
encrypted TOTP secret while the invitee sets it up), `AdminSession` refresh
tokens, and an `AuditLog` (`adminId?`, `action`, `entityType`, `entityId`,
`before`/`after` Json, `ipAddress?`). It has **no relation to
`User`/`Staff`**, while Sections 2.1/2.2 describe the Owner as a `Staff`
member with full `permissions`. `feature/auth` builds on this separate
system. See Section 18, item 10.

### Driver
`firstName`, `lastName`, `phone` (unique), `amountOwed`, `isExternal`,
`company?` (set when external — the "no branches, just source company"
decision), `trips[]`, `notes?`.

### Vehicle
`make`, `model`, `year?`, `images[]`, `plateNumber` (unique), `color`,
`isExternal`, `office?` (**note**: consider renaming to `sourceCompany` to
match `Driver.company` — same concept, inconsistent naming currently),
`trips[]`.

### VehicleImage
`vehicleId`, `bucket`, `key` (unique) — Cloudflare R2 object reference.

### AnalyticsDocument
`bucket`, `key` (unique), `month`, `year` — generated report files, not a
live analytics engine. Deliberately minimal.

### Notification / NotificationDelivery
Polymorphic as designed in Section 8: `userId?` / `guestSessionId?`, with
`NotificationChannel` = WHATSAPP / IN_APP / EMAIL. **SCHEMA GAP**: the
exactly-one `CHECK` constraint (same pattern as `Trip`) is not in the
migrations yet — see Section 18.

### Not yet in the schema at all
- **`Payment`** — deposit + final settlement + verification status (see
  Section 7). **SCHEMA GAP** — see Section 18.
- **`PriceRule`** — owner-editable rate table (see Section 6). **SCHEMA
  GAP** — see Section 18.

---

## 11. API Endpoint Reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/trips` | Public (rate-limited + Turnstile) | Create a trip as a guest |
| POST | `/api/trips/verify-otp` | Public, tied to a pending `GuestSession` | Confirm the WhatsApp OTP |
| GET | `/api/trips/:id` | Public, token-scoped | Rider checks trip status |
| POST | `/api/trips/:id/confirm` | Public, single-use token | Rider confirms after staff assignment |
| GET | `/api/pricing/quote` | Public | Compute a price quote from `PriceRule` for given route/vehicle/class |
| POST | `/api/admin/login` | Public (rate-limited) | Staff/owner authentication |
| GET | `/api/admin/trips` | Staff | List trips by status |
| POST | `/api/admin/trips` | Staff | Create a manual reservation |
| POST | `/api/admin/trips/:id/assign` | Staff | Assign car/driver/plate/time |
| POST | `/api/admin/trips/:id/cancel` | Staff | Cancel a trip (any reason) |
| GET | `/api/admin/customers` | Staff | Customer list/CRM view |
| GET | `/api/admin/pricing` | Owner only | View current `PriceRule` table |
| PUT | `/api/admin/pricing/:id` | Owner only | Edit a price rule |
| POST | `/api/driver-reports` | Driver (report-only auth) | Submit end-of-trip report |
| POST | `/api/webhooks/whatsapp` | Meta signature-verified | Delivery/read receipts, inbound messages |
| POST | `/api/webhooks/cashier` | Cashier signature-verified | Payment status callback |
| GET | `/api/admin/reports/financial` | Owner only | Generated `AnalyticsDocument` list |

*(This table reflects the intended surface based on everything decided so
far — it is not yet a 1:1 mirror of implemented routes. Update it as routes
land.)*

**Implemented so far** (on `feature/auth`, mounted **without** `/api`):

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health`, `/health/process` | Public | Process up / DB reachable |
| POST | `/auth/sign-up` | Public | Create a customer account (`User` + `Customer`) |
| POST | `/auth/sign-in` | Public, rate-limited | Sets `access` + `refresh` cookies |
| POST | `/auth/refresh` | Refresh cookie | Rotate tokens |
| POST | `/auth/sign-out` | — | Revoke the session; always succeeds |
| GET | `/auth/session` | Signed in | Current user's profile |
| GET | `/auth/verification` | Signed in | Status of the pending code (no new send) |
| POST | `/auth/verification/send` | Signed in | Send a 6-digit code by WhatsApp or email (10 min, 1 min resend cooldown) |
| POST | `/auth/verification/confirm` | Signed in | Check the code; activates the account |
| POST | `/auth/password/forgot` | Public | Send a reset link (same response whether or not the account exists) |
| GET / POST | `/auth/password/reset` | Reset token | Look up / use a reset link (30 min, single use; signs out all sessions) |
| POST | `/staff/invitations` | Staff with `*` | Invite a staff member by email |
| GET | `/staff/invitations/lookup` | Invitation token | Show who the invitation is for |
| POST | `/staff/invitations/accept` | Invitation token | Create the staff account |
| GET | `/admin/invitations/lookup` | Invitation token | Show who the admin invitation is for |
| POST | `/admin/invitations/totp` | Invitation token | Start authenticator setup (QR code) |
| POST | `/admin/invitations/accept` | Invitation token + TOTP code | Create the admin account |
| POST | `/admin/auth/sign-in` | Public, rate-limited | Password step; issues a 5-minute challenge |
| POST | `/admin/auth/verify` | Challenge cookie | TOTP step; sets `admin_access` + `admin_refresh` cookies |
| POST | `/admin/auth/refresh`, `/admin/auth/sign-out` | Admin refresh cookie | Rotate / revoke |
| GET | `/admin/auth/session` | Admin | Current admin's profile |

Nothing for trips, pricing, payments, drivers or notifications exists yet.
**OPEN:** the routes are mounted **without** the `/api` prefix used in the
table above, and the frontend now calls them that way (typed client in
`backend/src/client.ts`). Dropping the prefix from the planned table is now
the cheaper choice; confirm before building trip routes.

---

## 12. Security

- **HTTPS everywhere**; all secrets (DB credentials, JWT secret, WhatsApp
  token, Cashier keys, R2 keys) in environment variables, never committed.
- **Backend is fully authoritative** for pricing, authentication, and
  business rules — frontend validation is convenience only, never trusted
  for anything security- or money-relevant.
- **Rate limiting**: public booking endpoint, OTP-verification endpoint,
  admin login, and the `confirm`/`cancel` token-based endpoints (to prevent
  token brute-forcing even though tokens are single-use and expiring).
  **As built:** counters live in Postgres (`RateLimit` table,
  `src/shared/middleware/rateLimit.ts`), not Redis/Upstash as first
  planned — no extra service needed. Auth, invitation and reset routes are
  already limited.
- **Auth tokens**: short-lived (15 min) JWT access token + rotating refresh
  token, both in `httpOnly` cookies. Customers/staff and admins use
  **separate secrets** (`APP_SECRET` / `ADMIN_SECRET`) and cookie names, so
  one kind of token can never pass as the other. Passwords hashed with
  argon2; admin TOTP secrets encrypted with AES-256-GCM
  (`TOTP_ENCRYPTION_KEY`).
- **Cookies need one site.** Cookies are `SameSite=Lax`, so the frontend
  and backend must be on the same site (e.g. `terhal.com` +
  `api.terhal.com`). The two `*.vercel.app` domains are **different
  sites**, so sign-in can't work in production until a custom domain is
  set up (see `infra-architecture.md`, Section 7).
- **Cloudflare Turnstile** on the public booking form, ahead of the OTP
  step.
- **CORS** locked to the actual frontend origin(s) — no wildcard. (Live:
  the backend reads the allowed origin from `FRONTEND_URL`.)
- **Webhook signature verification** for both Meta's WhatsApp webhooks
  (`X-Hub-Signature-256`) and Cashier's payment callbacks — payloads are
  never trusted without verifying the signature first.
- **Consistent error response shape** that never leaks stack traces or
  internal details to the client in production.
- **No hard-deletes on `Trip`** — a cancelled/completed trip stays in the
  database forever (`status = CANCELLED` is the "delete"), since this is a
  business with money and audit trail involved.
- **Database backups**, tested by an actual restore at least once before
  go-live, not just scheduled and assumed to work.

---

## 13. Technology Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 16 | SSR matters for SEO on route/city landing pages |
| Backend | Hono | Runtime-agnostic — runs on Vercel now, portable to Cloudflare Workers later without a rewrite |
| Hosting | Vercel — two projects (`terhal-frontend`, `terhal-backend`), functions in Frankfurt (`fra1`) | Auto-scales well for the bursty seasonal (summer rush) traffic pattern, without manual capacity planning |
| Database | PostgreSQL on **Neon** (Frankfurt), Prisma 7 ORM | Serverless-friendly connection pooling, needed since serverless function bursts can exhaust a normal Postgres connection limit fast |
| CI/CD | GitHub Actions (checks + migrations) + Vercel Git integration (deploys) | PRs must pass checks before merging; merging to `main` deploys production |
| Object storage | Cloudflare R2 | S3-compatible API (no schema/interface change needed), zero egress fees, generous free tier |
| Bot protection | Cloudflare Turnstile | Free, low-friction, blocks spam before it reaches the DB or triggers an OTP send |
| Error monitoring | Sentry | Structured error visibility across frontend and API routes |
| Jobs / scheduling | Upstash QStash | Serverless-native queue/scheduling — replaces the need for a persistent BullMQ worker under serverless hosting |
| Location | Google Places API | Confirmed choice over a fixed city list |
| Messaging | WhatsApp Business Cloud API (Meta) | Primary notification/confirmation channel |
| Email | **Resend** | Verification codes, password resets, staff/admin invitations (in code on `feature/auth`) |
| Rate limiting | Postgres table (`RateLimit`) | No extra service; replaced the Upstash plan for rate limiting |
| Payments | Cashier (Visa, registered) | Only method with a real gateway integration so far |

Live today: Next.js, Hono, Vercel, Neon, GitHub Actions. In code on
`feature/auth`: Resend, Postgres rate limiting. Everything else in the table
is decided but not integrated yet — see `infra-architecture.md`.

---

## 14. Testing Strategy

- **Unit**: `PriceRule` quote calculation (including extra-hour/extra-stop
  surcharges), float/expense reconciliation math in driver reports, input
  validation on every public endpoint.
- **Integration**: full booking → OTP → confirm → staff-assign →
  notification-send → payment-verification → driver-report flow; the
  double-booking prevention check (same car/driver, overlapping time,
  buffer window); the manual-reservation creation path; repeat-customer
  matching at trip-creation time.
- **End-to-end**: the complete customer → staff → driver-report loop for
  both a normal-notice booking and a short-notice booking (verifying the
  escalation timing differs correctly between the two); VIP deposit +
  refund-on-cancellation path; a `QUESTIONABLE` payment flag reaching the
  owner's review queue.

No tests exist yet; both apps have a placeholder `npm test` that CI runs,
so real tests only need to replace the script.

---

## 15. Deployment & Environments

> **Status 2026-09-26:** steps 1–2 are done (Vercel projects, Neon
> database, first migration). The exact settings, domains and live
> environment-variable names are in `infra-architecture.md`, which
> supersedes the variable names listed in step 1 below.

1. **Vercel project** — connect the repo, set environment variables for
   `DATABASE_URL` (Neon, pooled), `WHATSAPP_TOKEN`,
   `WHATSAPP_PHONE_ID`, `CASHIER_API_KEY`, `CASHIER_WEBHOOK_SECRET`,
   `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_BUCKET`, `TURNSTILE_SECRET_KEY`,
   `GOOGLE_PLACES_API_KEY`, `SENTRY_DSN`, `QSTASH_TOKEN`, `JWT_SECRET`.
2. **Database** — Neon project, run `prisma migrate deploy`
   (never `migrate dev` in production). Done through the
   `migrate.yml` GitHub Actions workflow.
3. **Cloudflare** — R2 bucket created, Turnstile site key issued and wired
   into the booking form.
4. **WhatsApp Business Cloud API** — Meta Business verification, phone
   number registration, message template submission/approval (start this
   immediately — longest external lead time).
5. **Sentry** — project created, DSN wired into both frontend and API
   routes.
6. **Upstash QStash** — used for the assignment-deadline escalation checks
   and any retryable notification sends.
7. **Domain + DNS** — pointed at Vercel; live WhatsApp/Cashier webhook URLs
   registered against the real domain, not localhost/ngrok.
8. **Dry run** before go-live: a real booking, a real WhatsApp
   notification, a real staff assignment, a real customer confirmation,
   and a real (or test-mode) Cashier payment — on the live deployment, not
   just locally.

---

## 16. Immediate Next Steps (can run in parallel)

1. Start Meta Business verification + WhatsApp Cloud API template approval
   now — longest lead time of any external dependency.
2. Finalize `PriceRule` values with the client.
3. Confirm remaining payment-method flows with the client.
4. Confirm **Admin vs Staff** (Section 18, item 10) — `feature/auth` kept
   both; agree which one the owner uses before building dashboards.
5. Set up a **custom domain** for both apps — sign-in can't work on the two
   `*.vercel.app` domains.
6. Set up Resend (verified sending domain) and add the new secrets to
   Vercel — see `infra-architecture.md`, Section 4.
7. Reconcile the other schema gaps in Section 18 with your partner, then
   start the guest booking flow (`GuestSession` is unused so far).

---

## 17. Open Decisions — genuinely pending, do not guess

- **Exact pricing table** for this business's actual routes (client to
  provide; Grand Royal Group quote used only as a shape reference).
- **Exact flows for InstaPay / Vodafone Cash / Orange Cash / WePay** beyond
  the confirmed Cashier/Visa integration — manual only, or real API
  integrations later?
- **Hard cutoff behavior**, if any, for a trip that passes its pickup time
  with no assignment at all (currently: escalate only, never
  auto-cancelled — confirm this is acceptable indefinitely or if a hard
  stop is wanted eventually).
- **`/api` route prefix** — see Section 11.
- **Custom domain** — required for sign-in cookies to work in production
  (Section 12).

---

## 18. Known Schema Gaps — reconcile with your partner before building further

Differences between this document and the current schema
(`backend/prisma/schema/*.prisma` + `backend/prisma/migrations/`),
re-checked on **2026-10-02** against `feature/auth`. The schema is now **applied to the
production database**, so every fix below ships as a **new migration** —
never by editing an existing migration file. Do not resolve by guessing;
confirm with your partner directly.

| # | Gap | Status |
|---|---|---|
| 1 | `Notification` polymorphic owner | **Partly resolved** — `userId?` + `guestSessionId?` exist; the exactly-one `CHECK` constraint is missing |
| 2 | `NotificationChannel` missing `EMAIL` | **Resolved** |
| 3 | No `Payment` model | Open |
| 4 | No `PriceRule` model | Open |
| 5 | No upfront extra wait-hours / extra-stop fields on `Trip` | Open |
| 6 | `TripReport` uses mileage/GPS stops instead of float/legs | Open |
| 7 | `Vehicle.office` vs `Driver.company` naming | Open |
| 8 | No expiry tracking for driver/vehicle documents | Open |
| 9 | Requested-pickup field + dashboard index | **Partly resolved** — field exists as `Trip.pickupDate`; no `(status, pickupDate)` index yet |
| 10 | Separate `Admin` login system | **Built as option (b) on `feature/auth` — team to confirm** |
| 11 | `Trip` exactly-one customer/guest constraint | Open |

Details:

1. **`Notification` exactly-one constraint** — add a `CHECK
   (num_nonnulls("userId", "guestSessionId") = 1)` in a migration's SQL.
3. **No `Payment` model** — `Trip.totalPrice` is a single field with no
   deposit/final split, no verification status, no method enum. Needs a
   full `Payment` model per Section 7.
4. **No `PriceRule` model** — pricing is implicitly just `Trip.totalPrice`
   with no owner-editable rate table behind it. Needs a full `PriceRule`
   model per Section 6.
5. **No field for expected extra wait-hours or an additional stop
   requested upfront** — Section 6/3 confirmed this should be optional at
   booking time.
6. **`TripReport`/`TripStop` use a mileage/GPS-stop structure instead of
   the float/legs structure** that matches the business's actual paper/
   WhatsApp report format (Section 9) — needs restructuring to:
   previous float, new float, itemized expenses by category, and one or
   more legs each with a description, amount collected, and optional
   `tripId` reference for verification. Note that `TripReport.tripId` is
   currently unique (one report per trip), while the real process has one
   report covering several trips.
7. **`Vehicle.office` vs `Driver.company`** — same underlying concept
   (external-source attribution) named inconsistently. Recommend aligning
   on one name (e.g. `sourceCompany` on both).
8. **No expiry tracking on `VehicleImage`/driver documents** — needed for
   license/insurance expiry alerts (Section 9). There is also no model for
   driver documents at all yet, only `VehicleImage`.
9. **Dashboard index** — add `@@index([status, pickupDate])` on `Trip`
   for the "nearest trips first" dashboard query.
10. **`Admin` vs `Staff`** — `Admin`/`AdminSession`/`AuditLog` form a
    second login system with no link to `User`/`Staff`. Consequences:
    two sets of password/session logic to build; an `Admin` can't appear
    in `TripEvent` (which requires a `Staff` id), so the owner couldn't
    assign trips as the docs require; two separate audit logs. Options:
    (a) delete `Admin`/`AdminSession`, make the owner a `Staff` with full
    `permissions`, move TOTP fields onto `Staff`/`User`, and point
    `AuditLog` at `Staff`; or (b) keep `Admin` deliberately separate and
    document why. Option (a) matches Sections 2.1/2.2.
    **Update 2026-10-02:** `feature/auth` went with (b) — Admin kept
    separate, with mandatory TOTP and its own invitations, sessions and
    audit log. The consequences above still apply. Still to confirm and
    write down: which account the owner uses, what Admin can do that
    full-access Staff can't, and how admin actions on trips get into
    `TripEvent`.
11. **`Trip` exactly-one constraint** — add `CHECK
    (num_nonnulls("customerId", "guestSessionId") = 1)` in a migration's
    SQL, as Section 10 requires.

---

## 19. AI Agent Rules

1. **Inspect before modifying** — understand existing code/conventions
   before changing anything.
2. **Do not invent business rules** — anything marked OPEN in Section 17
   must not be silently filled in.
3. **Do not silently resolve Section 18 gaps** — confirm with the team,
   don't guess a resolution and build on top of it.
4. **Backend is authoritative** — never rely on frontend validation for
   security or business logic.
5. **Preserve existing functionality** — no unnecessary rewrites.
6. **Never expose secrets** — DB credentials, JWT secrets, payment
   credentials, WhatsApp tokens, R2 keys.
7. **Production runs on Vercel + Neon** (Cloudflare services planned). The
   Docker/LocalStack setup in the repo is for **local development only** —
   never assume it for production.
8. **Driver has no trip-visibility UI** — do not build one; explicitly
   decided against.
9. **No branches** — do not build a `Branch` entity; use
   `sourceCompany`/`company` on external `Car`/`Driver` records instead.
10. **Schema changes = new migrations.** Never edit an applied migration.
    Never run `prisma migrate dev` against Neon; production migrations run
    only through the `migrate.yml` workflow.
11. **Backend imports are relative** (`./app.js`, `../../shared/...`) — no
    `@/` alias. The Vercel entry is `backend/api/index.ts` using
    `getRequestListener` from `@hono/node-server` — never `hono/vercel`.
12. **All changes go through a pull request** — `main` is protected and
    requires the Frontend and Backend CI checks.

---

## 20. Short AI Context Version

```text
PROJECT:
Digitizing an already-operating limousine/intercity transport business in
Alexandria, Egypt. Real customers exist today. Target: live in 3 months.

STACK:
Next.js 16 + Hono backend, two Vercel projects (fra1) + PostgreSQL on Neon
(Frankfurt, Prisma 7). GitHub Actions for CI + migrations; main is
protected (PR + green checks). Planned: Cloudflare R2 (storage),
Turnstile (bot protection), Sentry, Upstash QStash (jobs), Google Places,
WhatsApp Cloud API, Cashier (Visa).

ROLES:
Owner (full access), Staff (view/assign, no pricing/financials),
Driver (report-only, NO trip-visibility screen), Customer (guest by
default, optional account).

BOOKING FLOW:
Name/email -> Google Places pickup/destination -> date/time -> vehicle type
(sedan/SUV/van/mini-van) x class (economy/VIP) -> passenger + luggage
counts -> optional extra hours/stop -> price shown (snapshotted PriceRule)
-> WhatsApp OTP (trip-seriousness check, not login) -> confirm -> staff
assigns exact car/driver up to 12h before pickup (urgent escalation if
close, immediate for short-notice bookings) -> WhatsApp + email
confirmation.

PRICING:
Route x vehicle x class table, OWNER-EDITABLE (fuel prices change daily).
Snapshotted onto Trip at booking. Round trip = drop-off + ~4hr included
wait + optional extra hours/stop, priced in upfront or reconciled after
via driver report. NOT YET IN SCHEMA — see gap list.

PAYMENTS:
VIP = refundable deposit upfront. All trips: remainder settled AFTER
completion via transfer (screenshot sent off-platform, staff manually mark
VERIFIED/QUESTIONABLE) or cash to driver. Only Cashier/Visa has a real
gateway integration so far. NOT YET IN SCHEMA — see gap list.

DRIVER:
NO trip visibility on the platform at all. Only submits an end-of-trip
report: garage times, one or more trip legs (each with amount collected,
optionally linked to a real Trip for verification), float/custody
reconciliation (previous + new float - expenses = net). Current
TripReport schema uses mileage/stops instead — needs restructuring.

NO BRANCHES. Use sourceCompany/company on external Car/Driver instead.

AUTH (feature/auth): customer sign-up/in, WhatsApp-or-email code, password
reset; staff by email invitation with permissions (["*"] = full); separate
Admin login with mandatory TOTP. JWT access + rotating refresh in httpOnly
SameSite=Lax cookies -> needs frontend+backend on one site (custom domain).
Email via Resend. Rate limiting in Postgres. WhatsApp sending is a stub
that throws in production.

SCHEMA GAPS (Section 18, checked 2026-10-02) — do not resolve by guessing;
schema is applied to production, so fixes are NEW migrations:
Admin vs Staff: built as separate systems on feature/auth, confirm with team. Missing CHECK
constraints on Trip and Notification. No Payment model. No PriceRule
model. No upfront extra-hours/stop fields. TripReport structure mismatch.
Vehicle.office vs Driver.company naming. No document expiry tracking.
No (status, pickupDate) index. Resolved: Notification polymorphic fields,
EMAIL channel.

OPEN / DO NOT INVENT (Section 17):
Exact pricing table (client pending). Exact flows for InstaPay/Vodafone
Cash/Orange Cash/WePay beyond Cashier/Visa. Hard cutoff behavior for
never-assigned trips. /api route prefix.

AI RULES:
Inspect before modifying. Never invent pricing/statuses/payment rules
marked open. Never silently resolve schema gaps. Backend authoritative.
Never expose secrets. No driver trip-visibility UI. No Branch entity.
Schema changes = new migrations via migrate.yml. Backend: relative
imports, getRequestListener (not hono/vercel). Everything via PR.
```
