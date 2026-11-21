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

---

## Code

### A modular monolith shaped like Hagz (2026-11-02)

The server follows the team's reference codebase: modules with `domain`/`application`/`http` layers, a shared
`platform`, contracts in `packages/contracts`, layer rules enforced by ESLint. Details in
[architecture.md](architecture.md#the-server-a-modular-monolith).

### Hono RPC for the client, OpenAPI for the documentation (2026-11-02)

See [architecture.md](architecture.md#why-rpc-and-not-a-generated-client-decided-2026-11-02).

---

## Infrastructure

### One VPS with Docker Compose, Neon for the database (2026-11-02)

See [infrastructure.md](infrastructure.md#why-one-vps-decided-2026-11-02).

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

Drivers get a link to the trip's report and fill it in with the trip code. **Open:** the code alone is a weak
credential. Revisit when the report flow is built (a signed, expiring link per trip, say).

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
