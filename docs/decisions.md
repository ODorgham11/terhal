# Decisions

> Why Terhal is built the way it is: each entry is a decision, when it was made, and what it costs. Read this before
> changing something that looks odd; it may be on purpose. The longer write-ups live next to the code they shape and are
> linked from here.
>
> Add an entry whenever a decision would surprise someone reading the code later. Newest last within each section. When a
> decision is reversed, don't delete it: mark it **Replaced** and link what replaced it.
>
> This repo is public: no secret, password or key belongs in this file.

---

## Product

### Single tenant (2026-10-22)

Terhal is the single-company rewrite of Rehletak, which was multi-tenant. There is no tenant layer: no tenant ids, no
per-company storefronts, no tenant keys. It serves one company, so Postgres handles its load easily and the risk is in
correctness, not scale ([architecture.md](architecture.md#principles)).

### One web app, one origin per audience (2026-10-22)

One Next.js app serves the customer site (`terhal.co`), the staff dashboard (`dashboard.`) and the admin panel
(`admin.`), routed by hostname in `apps/web/proxy.ts`. Paths (`/dashboard`, `/admin`) were considered first; subdomains
won because they make each audience its own origin, so a bug or XSS on one site can't act through another's session.
Each audience also has its own accounts, sessions, cookies and JWT secret
([architecture.md, Auth](architecture.md#auth)).

### Keep the admin panel separate from the staff dashboard (2026-11-20)

Admins (the platform's operators) and staff (the company's employees) stay separate audiences with separate accounts,
even though only the customer site and the staff dashboard are handed to the client. Admins sign in with a password and
a TOTP code.

### Arabic and English, right to left (2026-11-20)

Every host is fully localized in Arabic (the default) and English, with right-to-left layout for Arabic. The locale is a
cookie with a switcher on every page, not a URL prefix, so `proxy.ts` keeps mapping hosts only. Styles use logical
properties (`ms-`/`me-`, `start`/`end`), never left and right, so one layout serves both directions. Places and trip
classes carry both names (`nameEn`, `nameAr`).

### The name in Arabic is ترحال (2026-11-21)

Every Arabic text (emails, the interface) writes the product's name as **ترحال**.

### Verification codes go by email, for now (2026-11-21)

Customers confirm their account, and guests their contact details, with a 6-digit code. It's emailed: WhatsApp isn't
integrated yet. The schema keeps `WHATSAPP` as a `VerificationMethod`, so codes can move there once a provider is set up,
without a migration. A code lasts 10 minutes and dies after 5 wrong tries; only its hash is stored.

### Staff permissions (2026-11-21)

A staff member holds a list of coarse permissions (`trips`, `fleet`, `pricing`, `customers`, `team`, `analytics`,
defined in `packages/contracts/src/permissions.ts`), checked by the API on every request. The first staff member is
invited from the admin panel with every permission; after that, staff with `team` invite the rest.

### Barebones reset (2026-11-20)

The repo was stripped to an empty skeleton (no modules, models, migrations or pages) to rebuild the features cleanly.
Deployment (`deploy/`, the Dockerfiles, the workflows), the platform layer, Hono RPC and CI were kept. The schema came
back on 2026-11-21, reworked as described under [Data model](#data-model).

### Who owns what between the admin panel and the dashboard (2026-11-21)

The staff dashboard runs the business: trips, fleet, offices, trip classes, pricing, analytics and the team. It also
manages locations, with the same create, rename, move, delete and restore as the admin panel; location writes need the
`pricing` permission. Admins keep full control of locations, admins, the audit log and staff (for support and recovery),
and a read-only view of operations. Customers are the exception: staff can only view them (`customers` is a view-only
permission), and suspending or reactivating a customer is admin-panel only. Full spec: [domain-api.md](domain-api.md).

### Price on request (2026-11-21)

A route with no price can still be booked. The trip is created with no `totalPrice` (`priceState` `REQUESTED`), staff
propose a price, and the booker accepts it (or declines, which cancels the trip) before staff can confirm. Database
checks keep `totalPrice` empty only while a price is requested and stop an unaccepted price from being confirmed. A
priced booking carries the price the customer saw, and fails with `PRICE_CHANGED` if it moved since the quote; there is
no quote table.

What we gave up: a second step for the customer, and a trip that can sit unpriced until its pickup time, when it's
cancelled automatically.

### Customers can't cancel a confirmed trip online (2026-11-21)

A pending trip can be cancelled from the site at any time. Once staff confirm it, the site tells the customer to call;
only staff cancel confirmed trips, with a reason.

---

## Code

### A modular monolith shaped like Hagz (2026-11-02)

The server follows the team's reference codebase: modules with `domain`/`application`/`http` layers, a shared
`platform`, contracts in `packages/contracts`, layer rules enforced by ESLint. Details in
[architecture.md](architecture.md#the-server-a-modular-monolith).

### Hono RPC for the client, OpenAPI for the documentation (2026-11-02)

See [architecture.md](architecture.md#why-rpc-and-not-a-generated-client-decided-2026-11-02).

### Access tokens are checked against their session (2026-11-21)

Each access token carries its session's id, and every signed in request loads that session with its account. This
replaced loading the account alone, so it costs no extra query, and it means ending a session cuts its access token off
at once instead of up to 15 minutes later. It gives up the usual point of a JWT (checking it without the database); the
token is kept for its signature (forged cookies are rejected before any query), its expiry (the client's signal to
refresh) and its per-audience secret.

A refresh token used a second time after rotation is rejected but doesn't end the session (no reuse detection). The
cookies can't be read by page scripts and only reach `/…/auth`, so theft needs the device itself, and detection would
sign people out when a refresh response is lost on a bad connection. Revisit for customers' long sessions after launch.

### The web app's foundations (2026-11-21)

How the web app is built before its pages; details in [architecture.md, Web app](architecture.md#web-app).

- **Font: IBM Plex Sans Arabic, for both languages.** It draws Arabic and Latin to one design, so a page mixing them
  (an English name in an Arabic sentence, an email, a code) keeps one rhythm and x-height, and it's one family to load.
  A pair (an Arabic face plus Inter, say) was the alternative; two designs side by side look stitched together, and it
  doubles what's downloaded. Self-hosted through `next/font`.
- **Radix (the `radix-ui` package) for the hard parts of the UI kit**: Dialog, Drawer, DropdownMenu, Tabs, Toast. Focus
  trapping, keyboard handling and positioning are easy to get subtly wrong, and Radix handles right-to-left through its
  `DirectionProvider` (arrow keys, menus opening toward the inline end). It's the most used headless library and ships
  each primitive separately, so only what's imported is bundled. Everything else is native elements (`<select>`,
  checkboxes, radios, a checkbox with `role="switch"`), which are accessible already and work with react-hook-form's
  `register` without adapters. Base UI was the alternative; it's newer and less proven. `tailwind-merge` comes along so a
  page's `className` reliably overrides a component's.
- **Validation messages are rebuilt from each zod issue, not translated.** The contracts' messages are English and stay
  that way (they're the API's too, and its OpenAPI document). A message written on a schema wins over zod's error maps,
  so configuring zod can't localize them. `lib/forms/issues.ts` builds the sentence from the issue's code, its numbers
  (`minimum`, `maximum`), its format or regex pattern, and the field's name, and the API's `VALIDATION_FAILED` issues go
  through the same function. Cost: a new regex in the contracts needs its pattern added there for a precise message (it
  falls back to "{field} isn't valid."), and a new field needs its name in `common.fields`. Keying translations by the
  English text was rejected: rewording a message in the contracts would silently break the Arabic.
- **The locale cookie is written in the browser** and the page refreshed, rather than by a server action, so it behaves
  the same on every host with nothing to route through `proxy.ts`. It's host-only: each host remembers its own language.
- **Physical-direction classes fail the lint**, through a small local ESLint rule (`apps/web/eslint/logical-classes.mjs`)
  that checks every string in the app, since classes are assembled in `cn()` calls and maps as often as in `className`.

---

## Infrastructure

### One VPS with Docker Compose, Neon for the database (2026-11-02)

See [infrastructure.md](infrastructure.md#why-one-vps-decided-2026-11-02).

### Files live in Cloudflare R2 (2026-11-21)

Vehicle images and the monthly analytics workbooks go in a private R2 bucket. Uploads pass through the API, which checks
the type from the bytes and the size; reads use short-lived signed URLs. Nothing is stored on the VPS, so moving servers
stays a redeploy.

### A local folder for files in development (2026-11-21)

The storage provider (`apps/server/src/platform/storage`) has two drivers, picked by `STORAGE_DRIVER`. `s3` talks to any
S3-compatible bucket (R2 in staging and production) with the AWS SDK, and its read links are presigned. `local` writes to
a git-ignored folder (`apps/server/.storage`), and its read links point at the API's own `GET /v1/files`, signed with
HMAC-SHA256 (`STORAGE_SIGNING_SECRET`) and expiring like a presigned link, so code and tests behave the same with either.
Switching is the flag plus the `S3_` keys. Outside local development the server refuses to start unless the driver is
`s3` with every key, as it does without `RESEND_KEY`, so files can never land on the VPS's disk.

What we gave up: development doesn't exercise R2 itself (only the s3 driver's configuration and presigning are tested,
offline), and a developer needs one more secret in `.env`. MinIO in `infra/` was the alternative; it's another container
for something a folder does.

---

## Data model

### The database holds every rule it can (2026-10-22)

Optional relations use `onDelete: Restrict`, so deleting a row that others still point at fails instead of silently
nulling their reference. Things other rows depend on are archived or soft deleted instead of deleted: locations
(`deletedAt`), trip classes and offices (`archivedAt`). The audit log is append-only, enforced by triggers that reject
`UPDATE`, `DELETE` and `TRUNCATE`.

### A trip keeps what it was booked with (2026-10-22)

A trip stores snapshots of its class and its pickup and drop-off names at booking time, so renaming a class or a place
never rewrites past trips. `Pricing` is the estimate shown while booking; the trip's own `totalPrice` is what's charged.

### Exactly one owner, recipient or actor (2026-11-16)

Prisma can't express "exactly one of these columns is set", so CHECK constraints do:

| Check | Rule |
| --- | --- |
| `Trip_one_booker` | A trip is booked by exactly one of a customer, a guest and a staff member. |
| `Notification_one_recipient` | A notification goes to exactly one of a customer, a guest and a staff member. |
| `TripEvent_one_actor` | A trip event's actor is exactly one of a staff member, a customer, a guest and the system (`system` names the background job). |

### A trip stop can be anywhere (2026-11-16)

`TripStop.locationId` has no relation on purpose: a stop on a driver's report can be a free-form place the location tree
doesn't cover.

### Drivers have no accounts (2026-11-16)

Drivers get a link to the trip's report instead of an account. The trip code was the first idea for getting in; it's a
weak credential, so a per-trip token replaced it ([Driver report links](#driver-report-links-2026-11-21)).

### Offices (2026-11-21)

`Office` (fleet domain) is an outside company the business works with, such as a car rental office or another operator.
It replaced the free-text `Driver.company` and `Vehicle.office`. Optional links:

- `Driver.officeId` and `Vehicle.officeId`: the office an external driver or vehicle comes through. Only external ones
  can have an office (`Driver_office_is_external`, `Vehicle_office_is_external`); an external driver can also be
  freelance, with no office.
- `Trip.officeId`: the trip was handed off to an office, which supplies the driver and car.
- `Office.locationId`: where the office is, to find offices near a pickup.

### Coverage without PostGIS (2026-11-21)

The platform has to tell whether a pickup, a drop-off or the visitor's position is a place it serves. Each location has
a coverage shape, one kind per locality (`Location_shape`):

- A **governorate** has an outline, `boundary`, in Postgres's built-in `polygon` type with (longitude, latitude) points.
  It's optional; governorate outlines come from open data.
- A **district or an area** has a center (`latitude`, `longitude`) and a `radius` in meters. The application defaults it
  to 10 km; each place can have its own.

A point is covered if it's within the radius of any active district or area, or inside any active governorate's outline.
The most specific match wins: the nearest circle containing the point, else the governorate. Distances are computed with
the haversine formula in SQL, not Postgres's `circle` type, because a circle in degrees is an ellipse on the ground (about
13% narrower east to west at Egypt's latitude).

PostGIS was considered and not needed: everything is at city or governorate scale, where a flat-plane polygon test is off
by meters. It would pay off for distance-based pricing, nearest-driver searches or route corridors; Neon supports it,
and switching means converting the shape columns. Circles of neighbouring districts can overlap or reach past their
governorate; for coverage that's fine.

### Staff actions are audited too (2026-11-21)

`AuditLog` names its actor: an admin, a staff member, or neither (the system), never both (`AuditLog_one_actor`). What
staff change outside trips (prices, fleet, the team, locations) is recorded in the same transaction, and the log stays
admin-only. Trips keep their own history in `TripEvent`.

### Trip events carry their details (2026-11-21)

`TripEvent.data` holds what an event needs to be read on its own: the status it moved from and to, a reason, changed
fields with before and after values. Action names come from a fixed list in `@terhal/contracts`, like the audit log's.

### Money is Egyptian pounds; business time is Cairo's (2026-11-21)

There's no currency column: every amount is EGP, sent as a decimal string with two places, and checks keep prices and
expenses positive. Rules about time (booking lead times, "today", the monthly report, analytics days) use
`Africa/Cairo` on the server; the API sends and receives UTC instants.

### A vehicle can be an upgrade (2026-11-21)

Car bodies are ordered by size, SEDAN < SUV < MINIVAN < VAN (in contracts). A trip can be assigned a vehicle of its
booked body or larger, never smaller.

### Double booking (2026-11-21)

Trips have a pickup time but no end time, so a true overlap can't be computed. The database guarantees a driver or a
vehicle is on at most one trip in progress. Assigning one that has another live trip within three hours of the pickup
returns `ASSIGNMENT_CONFLICT` with the clashing trips, unless staff confirm they've seen it.

### Driver report links (2026-11-21)

Replaces the open question under "Drivers have no accounts". A driver fills in a report through a per-trip link holding a
random token, made on assignment. Only the token's hash is stored, it expires seven days after pickup, and it's
replaced when the driver changes. It sits in the URL fragment, so it never reaches server logs; the page sends it in a
header. Staff send it over WhatsApp click-to-chat until WhatsApp is integrated. The report locks for the driver once
submitted; staff can still correct it.

### The driver ledger (2026-11-21)

`Driver.amountOwed` is what the company owes the driver (negative when the driver holds company cash). It's the running
total of a `DriverTransaction` ledger, updated in the same transaction: trip fees (external drivers only), reimbursed
expenses (every expense on a report is assumed paid by the driver), cash collected from customers, payouts and manual
adjustments. Completing a trip writes its entries.

### Office fees are report expenses (2026-11-21)

What the business pays an office for a handed-off trip is an expense of type `OFFICE_FEE` on that trip's report. It
counts towards the trip's costs in analytics but never towards the driver's ledger. There's no separate `officeCost`
column.

### Fleet and office routes: the details the spec left open (2026-11-21)

How the fleet and office routes ([domain-api.md](domain-api.md), F and O) settle what the answers didn't:

- **"Upcoming live trip" is any pending, confirmed or in-progress trip**, whatever its pickup time: one past its pickup is
  still unresolved until the background jobs move it on. Awaiting a report doesn't block archiving. A blocked archive is
  `409 HAS_UPCOMING_TRIPS` listing up to 10 of the trips. The row is locked first, so an archive and an assignment can't
  cross (assignment must lock the same rows).
- **Archiving an archived row, or restoring a live one, changes nothing** and returns it, without an audit record.
- **The ledger:** staff post only `PAYOUT` (the amount paid, positive, stored negative; note optional) and `ADJUSTMENT`
  (signed, never zero, note required). Reading the ledger needs `fleet`, as the route table says, not `trips`. Archived
  drivers can still be paid. The response carries the new balance read back after the trigger ran.
- **Licences:** `licenseExpiresSoon` is true for a licence that has expired or expires within 30 days, by Cairo's date;
  `licenseExpiring=true` filters on the same. The columns stay nullable in the database (rows from before); the API
  requires both on create and never clears them.
- **Search:** drivers, vehicles and offices have no search column, so what's typed is normalized (`normalizeSearch`)
  and each word must be contained, case-insensitively, in one of the fields. Typing "احمد" finds "احمد" and so does
  "أحمد", but "احمد" doesn't find a stored "أحمد"; add search columns if that matters.
- **Links:** a new link to an office needs a live one, and an existing link to an office archived since can stay. Only
  external drivers and vehicles can have an office: the database checks it and the API answers
  `422 OFFICE_REQUIRES_EXTERNAL`. An office's location must be live when it's set or changed.
- **Images:** keys are `vehicles/<vehicle id>/<random uuid>`; the type is sniffed from the bytes and stored with the file.
  The 5-image limit is the database's position check (0–4) plus a lock on the vehicle while counting; a unique
  `(vehicleId, position)` index was left out because reordering would need a deferrable constraint Prisma can't
  express. The file is uploaded before the row is written and deleted if the row isn't; a deleted image's file is
  removed after the commit, so a failure can only orphan a file, never break a row. Every vehicle response (lists too)
  carries a 15-minute signed link per image. Archived vehicles keep and can change their images. The 100 KB JSON body
  limit lets the upload route through with room for 5 MB.
- **An office's detail** lists its live drivers and vehicles and the trips handed to it that are still live (soonest
  first, at most 100), not its history.
- **Nearby offices** aren't paged and return `{ location, data }`: the place the pin resolved to, then the offices placed
  in it, its ancestors or its live descendants, by distance from the pin to the office location's center; offices placed
  at a governorate (no center) come last. A pin outside coverage gets an empty list, not an error. The pin is resolved
  by a small query in the fleet module until the locations module's coverage is merged.
- **Tables of modules that don't exist yet:** the fleet module reads `Trip` and `Location` directly, marked with TODOs to
  go through the trips and locations modules once they exist.

### Accounts carry a locale (2026-11-21)

`Customer`, `GuestSession` and `Staff` have a `locale` (`ar` by default, or `en`), taken from the site's locale cookie
when the account or session is made, so emails and notifications go out in the recipient's language.

The API is on another host, so it can't read the site's cookie: sign up and guest start take `locale` in the body
(Arabic when left out). Verification codes and password resets go out in the recipient's language alone. Staff
invitations stay bilingual, since the invitee has no account yet, and so do admin emails: admins have no locale.

### Managing the team (2026-11-21)

Staff with `team`, and admins, list staff, set their permissions, suspend, reactivate and delete them, and list, revoke
and resend invitations. Anyone with `team` can grant any permission. Nobody changes their own permissions, suspends or
deletes themselves (`CANNOT_TARGET_SELF`), and at least one active staff member always holds `team`
(`LAST_TEAM_MANAGER`): every active `team` holder's row is locked for the change, like the last-admin rule, so two
managers acting on each other at once can't leave nobody. Changes take effect on the target's next request.

- **Deleting is soft and final.** The status becomes `DELETED`, sessions end, and the email becomes
  `deleted-<id>@deleted.invalid` so the address can be invited again; the audit entry keeps the real one. Acting on a
  deleted staff member again is `ACCOUNT_DELETED` (deleting again changes nothing). The team list hides deleted staff
  unless asked for by status.
- **Suspending and deleting also cancel a pending password reset link.**
- **Resending an invitation** gives it a new link, valid for 7 more days, even when it had expired; the old link stops
  working (only its hash is stored, so it can't be sent again). The invitation list therefore includes expired ones.
- **Every invitation is audited now**, from the dashboard too, under the staff member who sent it.
- **Admins manage staff without a fresh authenticator code**, unlike managing other admins: it's support work on another
  audience's accounts, and the guard rails still apply.
- **Staff session changes aren't audited**, matching staff sign in, which isn't either; a staff password change is.

### Customer self-service (2026-11-21)

Customers edit their name and language, and change their password (ending their other sessions) and their sessions
under `/v1/site/account`. A new email or phone needs the current password, so an open session alone can't take the
account, and waits in `pendingEmail` or `pendingPhone` until the emailed code confirms it: the code goes to the new email,
or for a phone, to the current email (there's no SMS yet). It reuses the sign up code columns, so one change waits at a
time (`Customer_one_pending_change`), and asking again replaces it. Confirming an email change cancels a reset link sent
to the old address. An address another account took meanwhile is `ACCOUNT_ALREADY_EXISTS`. The old address isn't told
of the change yet.

### Customers as staff and admins see them (2026-11-21)

The `customers` module is a read-only view: the list (`customers` or `trips`), a customer with their trip count and the
total of their completed trips, and their trips (`customers`); admins see the same. It reads the `Trip` table directly
until a trips module exists to ask. Suspending and reactivating are admin-only and live in identity: both take a reason
(kept in the audit log), suspending ends sessions at once and cancels a reset link, and reactivating restores `ACTIVE`, or
`UNVERIFIED` for a customer who never verified.

---

## Process

### One migration per domain (2026-11-21)

Each domain has exactly one migration, and its constraints and triggers live in it. While there's no client data in
production, schema changes are folded into those migrations and the environments are wiped. Details in
[architecture.md](architecture.md#migrations).

### Branches, releases and commits (2026-10-22)

Work happens on `dev` (or a branch off it). `staging` and `main` change only through PRs, `dev` → `staging` → `main`,
merged with merge commits. Commits are small, one logical change each, with subjects that are full sentences ending in
a full stop. See the README, "Branches and releases".
