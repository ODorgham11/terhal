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
permission), and suspending or reactivating a customer is admin-panel only. Full spec: [domains.md](domains.md).

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
| `TripEvent_one_actor` | A trip event's actor is exactly one of a staff member, a customer, a guest, the driver (through the report link, added 2026-11-21) and the system (`system` names the background job). |

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
total of a `DriverTransaction` ledger, updated in the same transaction: trip fees (every driver), reimbursed
expenses (every expense on a report is assumed paid by the driver), cash collected from customers, payouts and manual
adjustments. Completing a trip writes its entries.

### Office fees are report expenses (2026-11-21)

What the business pays an office for a handed-off trip is an expense of type `OFFICE_FEE` on that trip's report. It
counts towards the trip's costs in analytics but never towards the driver's ledger. There's no separate `officeCost`
column.

### Fleet and office routes: the details the spec left open (2026-11-21)

How the fleet and office routes ([domains.md](domains.md), F and O) settle what the answers didn't:

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
  by the locations module's `resolvePin`.
- **Tables of other modules:** an office's and a driver's trips come from the trips module. Still read directly: live
  trips when archiving (inside the archive's lock), and an office's location (marked with a TODO).

### Locations, pricing and quotes: details the spec left open (2026-11-21)

Choices made while building the location, trip class, pricing and quote routes, closest to [domains.md](domains.md):

- **A delete's `expectedCount` is a query parameter** (`DELETE …/locations/{id}?expectedCount=3`), not a body. The
  detail route returns it as `subtreeSize`; a mismatch is `LOCATION_COUNT_MISMATCH` with the current `count`.
- **Deleted locations can't be edited** (`LOCATION_DELETED`): restore first. Restoring a location that went with an
  ancestor, or whose parent is deleted, is `LOCATION_NOT_RESTORABLE`.
- **Governorate outlines are one ring.** The column is a single polygon, so the seed keeps a multipolygon's largest part
  and drops islands (the Red Sea's, Port Said's). Matching is by English or Arabic name, normalized.
- **The outlines' licence is ODbL, not CC BY.** geoBoundaries' Egypt ADM1 (gbOpen) is derived from OpenStreetMap and
  published under ODbL 1.0, so the attribution served with the outlines credits geoBoundaries and OpenStreetMap
  contributors. Simplified, the 27 outlines are about 63 KB uncompressed.
- **An outlines URL with an old `v`** gets the current outlines cached for a minute instead of for good, so a stale
  version never pins wrong data in a cache.
- **The pricing walk ranks pairs by locality**, not by steps up the tree: a pair's specificity is the sum of its ends'
  (area 2, district 1, governorate 0), ties going to the more specific pickup. So "Cairo → Smouha" (an area) beats
  "Maadi → Alexandria", and an area sitting directly in a governorate counts as specific as one in a district.
- **Bad references in a price are `VALIDATION_FAILED`**, with the field's path (`fromId`, or `rows.3.classId` in a bulk
  upload): unknown or deleted places, unknown or archived classes, an area priced to itself, a row repeated in an
  upload. Only a clash with an existing row is its own code, `PRICING_EXISTS`. Changing a price changes only the price;
  a different route, class or body is another row. Archived classes keep their rows, which can still be repriced.
- **A quote lists every active class with every car body, each with `fits`.** The answers say the site shows the ones
  that fit; returning all of them with the flag lets the site do that and still explain why a body is missing.
- **A quote's return leg takes optional pins, not a date.** Prices don't depend on time (P4 a), so the date waits for
  booking; the pins default to the outbound's reversed (R2). Either leg resolving to one place is `QUOTE_SAME_PLACE`
  with `leg`; a pin outside coverage is `OUT_OF_COVERAGE` with `end` and `leg`. Both are 422.
- **Upcoming trips in a location's usage** are pending or confirmed trips picking up or dropping off there.

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
total of their completed trips, and their trips (`customers`); admins see the same. Its trips come from the trips
module's index (they were read from the `Trip` table until that existed). Suspending and reactivating are admin-only and
live in identity: both take a reason (kept in the audit log), suspending ends sessions at once and cancels a reset link,
and reactivating restores `ACTIVE`, or `UNVERIFIED` for a customer who never verified.

### Trips: the details the spec left open (2026-11-21)

Choices made building booking, the lifecycle, price on request, assignment and links, closest to
[domains.md](domains.md):

- **One function changes a trip.** `changeTrip` locks the row, checks the status, updates on the status it found and
  records the `TripEvent` (`from`/`to`, each other changed field's `before`/`after`, a reason); creation and the second
  side of a link use `recordTripEvent`. Both end in `afterTripEvent` (`application/hooks.ts`), the single hook for
  notifications. `onTripCompleted` and `onTripReopened` are where the driver ledger plugs in, and `onDriverChanged` where
  a new report link is issued; a new driver already clears the old link's hash. Report token columns never reach an
  event.
- **Place snapshots carry both names.** `pickupSnapshot`/`dropoffSnapshot` hold the English name, and
  `pickupSnapshotAr`/`dropoffSnapshotAr` (added to the trips migration) the Arabic, like the class snapshot. Fleet and
  customer views still show the English one.
- **Idempotency.** The `Idempotency-Key` header (8 to 100 characters) is required for site and staff bookings alike. The
  stored key is a hash of the key with the booker behind the request (customer, guest session or staff member), so two
  bookers never collide; only the outbound leg carries it. A first booking answers 201, a replay 200 with the same trips.
- **The pending cap** counts a customer's pending trips, or a guest's across every verified session with the same email,
  both legs of a return included. Bookings by one booker are serialized with a transaction-level advisory lock (fine
  behind the pooler), so simultaneous ones can't pass it together.
- **Pickup times.** The grid is checked in UTC: Cairo's offset is whole hours, so a quarter hour is the same in both. A
  return must pick up after its outbound (`BEFORE_OUTBOUND`). Staff edits have no time rule.
- **A return's price** is checked like the outbound's, against `return.expectedPrice` on the site (the quote's
  `returnPrice`) or set with `return.totalPrice` by staff.
- **Staff bookings** name a customer by `customerId` (picked from the customer list, searched by phone or email; it must
  be active). The price is `totalPrice` if given, else the price list's, else on request, which only a customer's trip
  may be (`PRICE_REQUIRED`). Without a customer the passenger's name and phone are required. A backdated trip stays
  pending like any other; the expire job skips trips booked after their own pickup time, so staff can confirm it.
- **Accepting a price** covers every proposed leg of the booking, and `expectedPrice` is their total; `PRICE_CHANGED`
  carries the current total and each leg's price. **Declining** needs a proposal on that trip. Declining the outbound
  also cancels its pending return (`trip.cancelled` with reason `PRICE_DECLINED`), declining the return only that one.
- **Online cancellation** takes the whole booking (the trip, its outbound or return) minus legs that started or were
  cancelled. If any leg left is confirmed, nothing is cancelled (`CALL_TO_CANCEL`). The optional reason is kept as the
  event's `note`, with reason `CUSTOMER_REQUEST`. Staff cancel one leg at a time.
- **Completing doesn't require a report yet**: the driver report isn't built, so the report work decides whether to
  require one (office trips may complete without, D9 a). **Replaced** by
  [The driver report](#the-driver-report-the-details-the-spec-left-open-2026-11-21): a trip with a driver needs one.
- **Editing** (B10 a): details while pending or confirmed, `totalPrice` and payment until completed. The price can't be
  edited while it's requested or proposed (`PRICE_REQUEST_OPEN`). A new pin resolves again, refreshing the place and its
  names; a new class refreshes its snapshot; a new body must fit the load and the assigned vehicle. An edit of only
  `paymentMethod`/`paidAt` is a `trip.payment_recorded` event, anything else `trip.updated`.
- **Assignment** replaces the whole assignment: what's left out is cleared, and a driver without a vehicle (or the
  reverse) is allowed until starting. Only a newly set driver or vehicle is checked for conflicts, within ±3 hours
  inclusive; acknowledged clashes are listed in the event. Candidates list every live driver and only the live vehicles
  that fit. The rows are locked through fleet's `lockAssignees`; the trip views read customers, guests, staff, drivers,
  vehicles and offices through Prisma relations.
- **Trip status conflicts** carry the trip's status as `tripStatus`: `status` is the HTTP status in a problem.
- **Links** join two unlinked trips only, so a booking stays a pair, and the return must pick up later. Unlinking works
  from either trip; both get an event.
- **The overview**: today and tomorrow are non-cancelled trips picking up in that Cairo day; unassigned is pending or
  confirmed without an office and without a driver or a vehicle (the list's `unassigned` filter too); overdue is pending
  or confirmed past its pickup time; price requests are pending trips with a requested price. The staff list is newest
  pickup first, and `q` matches the code, passenger name and phone with a contains (no search column, as for fleet).
- **Jobs** run on one `trips` queue: `expire-pending-trips` every minute, `advance-overdue-trips` every 5 minutes, as
  BullMQ job schedulers named after the jobs. Expired trips record reason `NOT_CONFIRMED` or `PRICE_NOT_SETTLED`;
  overdue ones `trip.ended` with reason `OVERDUE`, from confirmed too.
- **Reopening** is refused by the pickup's Cairo month; the analytics module doesn't exist yet, so `AnalyticsDocument`
  is read directly.
- **Rate limits** (X7): booking on the site 10 an hour per IP; site trip reads 120 and changes 30 a minute per booker;
  dashboard trip reads 240 and changes 120 a minute per staff member.

### The driver report: the details the spec left open (2026-11-21)

Choices made building the report link, the report routes and the ledger on completion, closest to
[domains.md](domains.md#d-driver-report):

- **Staff can show the link again.** The spec said only the token's hash is stored and the link is shown once, but the
  dashboard also needs to show it again ("Send report link" after it was issued on assignment) without breaking the
  link the driver already has. So the token is an HMAC of the trip, the driver and a random salt under its own secret,
  `REPORT_LINK_SECRET` (`keyedToken`). The trip stores the hash (to find the trip from a token), the salt and the expiry
  (`Trip_report_token`: all three or none). A leaked database alone still opens nothing. Changing the secret breaks every
  live link and nothing else; staff then make new ones. It was first derived from `TOTP_ENCRYPTION_KEY`, but that tied
  the links to the admins' authenticators: rotating one would have broken the other, and that key can't be rotated
  without re-encrypting every two-factor secret (2026-11-21). `GET …/report-link` shows the link,
  `POST …/report-link` replaces it (the old one stops working, `trip.report_link_issued`).
- **Issued on assignment** (`onDriverChanged`), with no event of its own: the assignment's event says the driver
  changed. Removing the driver removes the link. The expiry (7 days after pickup) moves when staff move the pickup.
- **WhatsApp.** The route returns the plain link, a prefilled message in `?locale=` (Arabic by default; drivers have no
  locale) and a `wa.me` link to the driver's phone with it.
- **The driver is a trip event actor.** `TripEvent.driverId`, counted by `TripEvent_one_actor`, so the history says the
  driver started, ended or reported the trip; the dashboard shows the actor as `DRIVER`.
- **The driver's routes** are `/v1/site/driver/report` (read), `/start`, `/end` and `PUT` (submit), with the token in a
  `Report-Token` header, limited per IP to 60 reads and 20 changes a minute. A bad or replaced token is 401
  `REPORT_LINK_INVALID`, an expired one 401 `REPORT_LINK_EXPIRED`; the token is checked again on the locked trip, so a
  link replaced a moment ago can't act. The view carries when the trip was started and ended, to prefill the report.
- **Submitting** is allowed once the trip has started: a trip still in progress is ended by it (an ENDED event by the
  driver). After that it's locked for the driver (`REPORT_ALREADY_SUBMITTED`). Drivers can't enter `OFFICE_FEE`.
- **Staff** read the report (`GET …/report`, 404 until there is one) and fill in or correct it with
  `PUT …/report`, replacing it whole, while the trip awaits its report (after `end`, or after reopening). The first
  write is `trip.report_submitted`, later ones `trip.report_edited`.
- **Cash collected is a report field** (`TripReport.cashCollected`, zero or more, `TripReport_cash_collected`), since
  the driver is the one who knows. On an unpaid trip, cash above zero records the payment (`CASH_TO_DRIVER`, paid at
  the report's end time) as a `trip.payment_recorded` event.
- **Completing requires a report for a trip with a driver** (`REPORT_REQUIRED`); staff fill it in when the driver
  doesn't. An office trip may complete without one (D9 a). Every non-office trip that reaches awaiting report has a
  driver, since starting needs one.
- **The ledger on completion** (D8 a, O1 b), from the report, as the completing staff member: `TRIP_FEE` = the report's
  `DRIVER_FEE` expenses, for every driver: internal drivers are paid per trip too and often keep their fee out of the
  cash they collected (changed from D8 a's "external only" at the client's request, 2026-11-21);
  `EXPENSE_REIMBURSEMENT` = every other expense except `OFFICE_FEE`, summed into one entry; `CASH_COLLECTED` = minus the
  cash collected. Zero entries are skipped. An office trip with a recorded driver follows the same rules; without a
  driver or a report it writes nothing.
- **Reopening reverses with adjustments.** The ledger is append-only and its sign check keeps `TRIP_FEE` positive, so a
  reversal is one `ADJUSTMENT` per driver for minus what the trip's entries still add up to. Only trips write entries
  naming a trip (staff payouts and adjustments don't), so that sum is exactly what earlier completions left standing,
  and completing again counts the corrected report once.

### Analytics reads across modules (2026-11-21)

The analytics module is a read-only view of the whole business, so it queries the trip, fleet, customer and location
tables directly (raw SQL for the figures, Prisma for the exports and the workbook) instead of asking each module for
its rows. Going through every module's `index.ts` would mean one bespoke query per figure in five modules, or loading
rows into memory to join them in code. It never writes another module's tables; its only table is
`AnalyticsDocument`. The price list CSV is the exception: the pricing module already exports it, so analytics serves
that file through pricing's `index.ts`.

What we gave up: a column renamed in another module can break an analytics query without that module's code changing.
The analytics tests cover every query, so `pnpm test` catches it.

### Analytics: the details the spec left open (2026-11-21)

How the analytics figures, the exports and the monthly report ([domains.md](domains.md), Y) settle what the answers
didn't:

- **The range is Cairo calendar days.** `GET /v1/staff/analytics` takes `from` and `to` as dates (`YYYY-MM-DD`, both
  included), not instants: a trip belongs to the range when its pickup falls between Cairo midnight on `from` and Cairo
  midnight after `to`. At most 1,100 days. The bounds are computed by Postgres (`AT TIME ZONE 'Africa/Cairo'`), so the
  summer clock is handled by its time zone database. The trips CSV keeps the trip list's filters (instants), so the
  list can export what it shows.
- **Which trips each figure counts.** `totals.trips` and the trend count every trip, cancelled ones too, which is what
  the cancellation rate divides by. Breakdowns (class, body, source, routes, fleet) count trips not cancelled, with
  how many completed and what those earned. Revenue is completed trips' `totalPrice` (Y2); booked value is every trip
  not cancelled that has a price. Expenses are those on completed trips' reports, office fees included (O1 b), so the
  margin (revenue − expenses) compares like with like; an unfinished trip's costs show once it's completed.
  `unpaid` is completed trips without `paidAt` (B8). Driver balances are the ledger's totals now, whatever the range.
- **Buckets.** The trend lists every bucket in the range, empty ones too. Weeks start on Sunday, the first day of
  Egypt's working week (the client's choice, 2026-11-21); a bucket at either end holds only the range's days. Top routes are the 10 busiest governorate pairs
  (each end's root in the location tree); the busiest drivers and vehicles are capped at 50.
- **Money stays exact.** Postgres sums the decimals and returns text; the margin and the average are computed in
  piastres with `bigint`, never floats.
- **The trips CSV** counts the matching trips first and refuses more than 50,000 with `422 EXPORT_TOO_LARGE`
  (`count`, `limit`) before sending anything; the stream also stops at 50,000. Rows are read 1,000 at a time and
  written as they're read. Its columns are the trip's details, the Cairo pickup time, who booked it, the assignment and
  the report's expense total. Drivers, vehicles and customers (deleted accounts left out) stream the same way, without
  a cap. Every CSV is UTF-8 with a byte order mark, and text starting with `= + - @`, a tab or a carriage return gets a
  leading apostrophe; a negative amount is left as a number.
- **Permissions.** Everything needs `analytics`, except the trips CSV, which also takes `trips`. Pricing's own export
  still needs `pricing`; `/v1/staff/exports/pricing.csv` serves the same file to `analytics`. Reads are limited to 60 a
  minute per staff member, exports and regeneration to 10.
- **The monthly report** is an XLSX workbook written by exceljs's streaming writer: a summary sheet (the month's
  figures), then the month's trips (the CSV's columns, amounts as numbers), expenses, driver ledger entries made in the
  month, and office fees. Cells hold values, never formulas. It's stored at `analytics/reports/<yyyy-mm>.xlsx` through
  `platform/storage`, so the local folder and R2 are the same code; switching is `STORAGE_DRIVER`.
- **Regenerating is idempotent.** A month has one key and one `AnalyticsDocument` row (now with `size` and
  `updatedAt`), so regenerating replaces both; the file is written before the row. Only a month that's over in Cairo
  can have a report (`422 REPORT_MONTH_NOT_OVER`): a report for a running month would stop its trips being reopened
  (T8 a) while they can still change. It's generated in the request (a month is a few thousand rows), and returns the
  report.
- **The job.** BullMQ job scheduler `monthly-report` on its own `analytics` queue, cron `0 2 1 * *` in `Africa/Cairo`:
  02:00 on the 1st, for the month before. It skips a month that already has a report, so retries (5, backing off from
  a minute) and reruns change nothing. Each worker start also adds a one-off `monthly-report-<yyyy-mm>` job for the
  previous month, so a 1st missed while the worker was down is caught up; its id makes adding it again a no-op.
- **Download links** last 15 minutes (`SIGNED_URL_LIFETIME`). The link is made from the row's key with the storage in
  use; `bucket` on the row is informational.

### Notifications go through an outbox (2026-11-21)

The trips hook (`afterTripEvent`) runs inside the change's transaction, but a BullMQ job can only be queued once that
transaction has committed: queued earlier, a rolled back change would still email; queued after, a crash between the
commit and the queue would lose the email. So the hook only writes rows (the notifications, a `PENDING` email
`NotificationDelivery` for the booker, the trip's `NotificationReminder`s), and a scheduled job,
`sweep-notifications`, runs every 5 seconds to queue every pending delivery not yet queued and move reminder jobs to
match their rows. Job ids are deterministic (`delivery.<id>`, `reminder.<kind>.<trip>.<due ms>`), so two sweeps, or a
sweep after a crash, add nothing. A delivery still pending 30 minutes after it was queued (Redis was emptied) is
queued again.

What we gave up: an email goes out up to 5 seconds after the change, and the sweep is two cheap indexed queries every
5 seconds whether or not there's anything to send.

### Notifications: the details the spec left open (2026-11-21)

- **Who is told what** (N1, Q3) is one pure function of the event and the trip afterwards (`notifications/domain`):
  - The driver's details (A6 a) are emailed when a confirmed trip is assigned or reassigned, and with the confirmation
    if it was assigned before; assigning a pending trip emails nothing. Unassigning emails nothing.
  - Each leg of a return booking is its own trip and gets its own emails.
  - A staff member's own booking (no customer) tells nobody. A staff booking for a customer emails them
    `BOOKED_BY_STAFF`; booked without a price, the rest of the team gets `PRICE_REQUESTED`.
  - Staff in-app notices go to every active staff member with `trips`, except the one who acted.
  - A booker who declines a price gets a cancellation receipt and staff get `PRICE_DECLINED`; the return leg cancelled
    with it adds no second staff notice.
  - Completing a trip again after a reopen doesn't thank the booker twice (its dedupe key is the trip, not the event).
  - "Report submitted" is keyed on the existing `trip.report_submitted` action, which the driver report records with
    the driver as actor (`{ driverId }`). A driver's start or end and report edits or links tell nobody; a cancellation
    by anyone but the booker is a `TRIP_CANCELLED` email with its reason.
- **Dedupe keys.** Every notification has a unique `dedupeKey` naming its cause and recipient
  (`event.<event id>.<recipient>`, `reminder.<kind>.<trip>.<due ms>.<recipient>`), so a retried job never writes it
  twice.
- **In-app is not a delivery.** Staff notifications are the inbox: `Notification.readAt` is their state, and
  `NotificationDelivery` rows exist only for outbound sends (email now, WhatsApp later). The unread count is one count
  over a partial index on unread staff rows (`Notification_staff_unread`).
- **Reminders** are rows, one per trip and kind (`PICKUP` 24 h before a confirmed pickup, `PRICE` 24 h before pickup
  while a proposal is unanswered, `UNASSIGNED` 2 h before pickup while there's neither an office nor a driver and a
  vehicle). Every trip event recomputes them, so a pickup change moves them and a cancel, an assignment or an answer
  drops them. The delayed job only wakes the worker: it sends only if the row still holds that time and the trip still
  calls for it before its pickup, then clears the row. A booker reminder already past when scheduled (confirmed 10 hours
  ahead) is dropped; the unassigned warning is sent at once as long as the trip hasn't picked up.
- **Delivery:** 6 attempts with exponential backoff from 30 seconds. Each attempt counts on the row with its error, and
  the last marks it `FAILED`. Resend gets the delivery's id as an idempotency key, so a retry after a send that went
  through but wasn't recorded doesn't email twice.
- **Language (N5):** the title and plain text are written at notification time in the recipient's locale and stored;
  the HTML (right to left for Arabic, with codes, phones and links kept left to right) is rendered again from the
  stored `data` when it's sent. Times are Cairo's. The booker's link is `SITE_URL/trips/<id>`, which the site has to
  serve.
- **Reads across modules.** Notifications reads trips, customers, guests, staff and fleet rows straight through Prisma,
  read-only, instead of through their modules: the trips hook calls into notifications, so calling back into trips
  would make a cycle.

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
