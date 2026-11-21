# Domain API spec

The agreed behaviour of every domain API route (2026-11-21). It began as a list of questions, each with options and one
recommendation. The questions are kept below for their reasoning. **The [Answers](#answers) section at the end is the
spec:** where an answer differs from a recommendation, the answer wins, and anything the answers don't mention takes the
recommended option. The route tables are the agreed inventory, as updated by the answers.

Already decided and not re-asked: the three hosts and prefixes, the six staff permissions, coverage (polygons for
governorates, center plus radius for districts and areas, a coverage route, out-of-coverage pins rejected), offices and
the external-only rule, one booker and one actor per trip and event, free-form stops, pricing as an estimate with
`Trip.totalPrice` charged, snapshots, bilingual names, an admin-only audit log, `TripEvent` as trip history, and rules in
the database where possible.

## Gaps found in the schema

These shape several questions below; each is fixed only if the matching answer says so.

| Gap | Where it matters |
| --- | --- |
| `Vehicle` has no car body or capacity, so assignment can't check the vehicle fits the trip's `car`. | F1, A2 |
| `Driver` and `Vehicle` have no `archivedAt`; drivers with trips can never be removed (Restrict). | F2 |
| `Driver.amountOwed` has no default and no defined meaning (who owes whom). | D8 |
| `AuditLog` has only `adminId`, so nothing a staff member does (pricing, fleet, team) can be audited. | X1 |
| `TripEvent` has only `action`: no room for a cancellation reason, old/new values or a status change. | X2 |
| No sibling-name uniqueness on `Location`, no unique active name on `TripClass`. | L2, C2 |
| No locale on `Customer`/`GuestSession`, so emails can't be sent in the recipient's language. | N5 |
| `TripReport` has no checks (times in order, end mileage ≥ start) and nothing for driver access. | D1, D3 |
| No payment fields at all. | B8 |

---

## X. Cross-cutting (needed by every domain)

**X1. Auditing what staff do.** The audit log can only name an admin, so price changes, fleet edits, suspensions and
permission changes made in the dashboard leave no trace outside trips.
- a) Don't audit staff actions; `TripEvent` covers trips, the rest is untracked.
- b) Add `staffId` to `AuditLog` with an `AuditLog_one_actor` check (admin, staff or neither for system), record staff
  actions in the same transaction; still shown only in the admin panel. **(Recommended)** — one log, same append-only
  guarantees, matches "admin-only" while giving admins a full picture of what happened in the dashboard.
- c) A separate staff activity log shown to staff with `team`.

**X2. What a trip event carries.** Decides whether history can say "cancelled: customer changed plans" or "price 950 →
1,100".
- a) Keep `action` only.
- b) Add `data Json?` to `TripEvent` (from/to status, reason, changed fields with before/after), with a fixed list of
  action names in contracts like `auditActions`. **(Recommended)** — the dashboard's trip timeline needs it, and it's
  free now while migrations are still folded.

**X3. Money.**
- a) EGP only, no currency column; amounts as decimal strings with 2 decimals in the API (`"1250.00"`), prices > 0 and
  ≤ 1,000,000 enforced by CHECKs. **(Recommended)** — one company, one market; a column can be added later.
- b) Add a `currency` column now (to `Pricing`, `Trip`, `TripExpense`).

**X4. Time zone for business rules.** Lead times, "today", day boundaries in analytics and the monthly report.
- a) Everything in `Africa/Cairo` on the server; the API speaks ISO-8601 UTC instants. **(Recommended)** — one
  company in one country; staff in other zones would still see Cairo days.
- b) The client sends its zone per request (Rehletak's way).

**X5. Admin panel vs staff dashboard ownership.** Who sees and changes each feature. Proposed:

| Feature | Admin panel | Staff dashboard |
| --- | --- | --- |
| Locations and coverage | full CRUD | read only (search, coverage) — **answered: full CRUD** |
| Trip classes, pricing | read only | full (`pricing`) |
| Trips, assignment, reports | read only | full (`trips`) |
| Fleet, offices | read only | full (`fleet`) |
| Customers | view, suspend, reactivate | view, suspend, reactivate (`customers`) — **answered: view only** |
| Team (staff) | full, for support and recovery | full (`team`) |
| Analytics and reports | none | full (`analytics`) |
| Audit log | full | none |

- a) As above. **(Recommended)** — the client runs the business in the dashboard; admins keep visibility and a way to
  recover a locked-out team without editing operations behind staff's backs.
- b) Admin panel holds only locations, admins, staff and the audit log (no read-only operational views).
- c) Admins get full write access everywhere.

**X6. Reading across permissions.** Booking and assignment need driver, vehicle, office, class and customer lists, but
those belong to `fleet`, `pricing` and `customers`. (`requirePermission` today is all-of; this needs an any-of helper.)
- a) Read routes accept the owning permission **or** `trips`; writes need the owning permission. **(Recommended)**
- b) Separate slim "picker" routes under `trips` returning only id and name.
- c) Staff need every permission involved.

**X7. Abuse protection on public routes** (quote, coverage, guest booking). Turnstile isn't integrated yet.
- a) Redis rate limits per IP now (e.g. 60 quotes/min, 10 bookings/hour), Turnstile on booking when it's integrated.
  **(Recommended)**
- b) Integrate Turnstile now as part of this work.
- c) No limits until launch.

**X8. Arabic search.** Staff and customers search places, customers and trips by name in Arabic.
- a) Plain case-insensitive `contains`.
- b) Normalize both sides (alef forms أ إ آ → ا, ة → ه, ى → ي, strip diacritics and tatweel) through a generated
  search column. **(Recommended)** — otherwise "الاسكندرية" doesn't find "الإسكندرية".

**X9. Action routes vs a generic status route.**
- a) One route per action (`POST /trips/{id}/confirm`, `/cancel`, `/start`, …), each with its own body and checks.
  **(Recommended)** — clearer contracts and OpenAPI, per-action permissions and rate limits.
- b) One `POST /trips/{id}/status { status }` (Rehletak).

---

## L. Locations

Routes (proposed):

| Method | Path | Audience | Permission |
| --- | --- | --- | --- |
| GET | `/v1/admin/locations?parentId&q&locality&deleted&cursor` | admin | — |
| GET | `/v1/admin/locations/{id}` (with boundary, ancestors, usage counts) | admin | — |
| POST | `/v1/admin/locations` | admin | — |
| PATCH | `/v1/admin/locations/{id}` | admin | — |
| DELETE | `/v1/admin/locations/{id}` (soft) | admin | — |
| POST | `/v1/admin/locations/{id}/restore` | admin | — |
| GET | `/v1/admin/locations/coverage?latitude&longitude` | admin | — |
| GET | `/v1/staff/locations?q&locality&parentId&deleted&cursor` | staff | any |
| GET | `/v1/staff/locations/{id}` (with boundary, ancestors, usage counts) | staff | any |
| POST | `/v1/staff/locations` | staff | `pricing` (proposed) |
| PATCH | `/v1/staff/locations/{id}` | staff | `pricing` (proposed) |
| DELETE | `/v1/staff/locations/{id}` (soft) | staff | `pricing` (proposed) |
| POST | `/v1/staff/locations/{id}/restore` | staff | `pricing` (proposed) |
| GET | `/v1/staff/locations/coverage?latitude&longitude` | staff | any |
| GET | `/v1/site/locations` | public | — |
| GET | `/v1/site/locations/coverage?latitude&longitude` | public | — |

**L1. Parent rules.**
- a) Strict: governorate at the top, district under a governorate, area under a district.
- b) Parent must be broader: district under a governorate; area under a district **or** directly under a governorate;
  enforced by a trigger (`Location_parent_broader`) plus live-parent checks in the app. **(Recommended)** — small
  governorates and places like airports don't need a district in between.
- c) Any depth, any locality under any broader one, unlimited nesting.

**L2. Duplicate names.**
- a) Unique among live siblings, per language (partial unique indexes on `(parentId, lower(nameEn))` and
  `(parentId, nameAr)` where `deletedAt IS NULL`, roots included). **(Recommended)** — two "Maadi" under one parent
  is always a mistake; the same name in different governorates is fine.
- b) No uniqueness.

**L3. Deleting a location with live children.**
- a) Blocked until its children are deleted. **(Recommended)** — no surprise mass deletes; restore stays one row at a
  time.
- b) Cascade: soft-deletes the whole subtree; restoring brings back what that delete removed.

**L4. Deleting a location that's in use** (pricing rows, offices, upcoming trips).
- a) Allowed. Past and upcoming trips keep their snapshot and id; its prices stop matching quotes; offices keep the link.
  The detail route returns usage counts so the admin panel can warn first. **(Recommended)**
- b) Blocked while any pricing row or upcoming trip points at it.

**L5. Moving a location** (changing `parentId`).
- a) Allowed, subject to L1 and L2. **(Recommended)** — fixes data-entry mistakes without delete and recreate.
- b) Not allowed; locality and parent are fixed at creation.

**L6. Restoring.** Restore requires a live parent of a valid locality and a still-free name (L2), and fails with a clear
code otherwise. Confirm, or say otherwise: a) as stated **(Recommended)**; b) restore also restores deleted ancestors.

**L7. Which match wins when a district's and an area's circles both contain the point.** The decision says "most
specific, nearest circle", which is ambiguous between the two.
- a) Locality first (area beats district beats governorate), then the nearest center among the same locality.
  **(Recommended)** — an area is a deliberate, narrower definition.
- b) Nearest center wins regardless of locality.

**L8. What the customer site gets.**
- a) Only search and the coverage check.
- b) The whole active tree with names, centers, radii and governorate outlines (one cached response, ETag), so the map can
  draw where Terhal operates and search runs client-side. **(Recommended)** — it's small (hundreds of rows) and lets the
  map show coverage before the visitor drops a pin.

**L9. Loading governorate outlines.**
- a) Paste or upload GeoJSON per governorate in the admin form only.
- b) Both: a one-off seed script loading all 27 from open data, plus per-governorate editing in the form.
  **(Recommended)**

---

## C. Trip classes

| Method | Path | Audience | Permission |
| --- | --- | --- | --- |
| GET | `/v1/staff/trip-classes?archived` | staff | `pricing` or `trips` |
| POST | `/v1/staff/trip-classes` | staff | `pricing` |
| PATCH | `/v1/staff/trip-classes/{id}` | staff | `pricing` |
| POST | `/v1/staff/trip-classes/{id}/archive`, `/restore` | staff | `pricing` |
| GET | `/v1/site/trip-classes` | public | — |

**C1. What a class holds beyond its names.**
- a) Names only.
- b) Names plus a bilingual description (`descriptionEn`/`descriptionAr`, what's included) and a `sortOrder` for the
  site. **(Recommended)** — the booking page has to explain "Economy" vs "VIP"; the order matters for display.
- c) b plus an image.

**C2. Unique names.**
- a) Unique among active classes per language (partial unique indexes); restoring fails if the name was taken.
  **(Recommended)**
- b) No uniqueness.

**C3. Archiving a class.** Archived classes disappear from quotes, booking and the pricing editor's defaults; their
pricing rows stay (inactive) and come back on restore; existing trips are untouched. Confirm: a) as stated
**(Recommended)**; b) archiving is blocked while upcoming trips use the class; c) archiving deletes its pricing rows.

---

## P. Pricing

| Method | Path | Audience | Permission |
| --- | --- | --- | --- |
| GET | `/v1/staff/pricing?fromId&toId&classId&car&q&cursor` | staff | `pricing` or `trips` |
| POST | `/v1/staff/pricing` (`bothWays` option) | staff | `pricing` |
| PATCH | `/v1/staff/pricing/{id}` | staff | `pricing` |
| DELETE | `/v1/staff/pricing/{id}` | staff | `pricing` |
| PUT | `/v1/staff/pricing` (bulk upsert, up to 500 rows, all or nothing) | staff | `pricing` |
| GET | `/v1/staff/pricing/export.csv` | staff | `pricing` |

**P1. How a quote finds a price.**
- a) Exact pair only: the most specific pickup and drop-off locations must have a row.
- b) Walk up the tree: try every (pickup ancestor, drop-off ancestor) pair from most to least specific and take the first
  with a row for that class and body; ties prefer the more specific pickup. **(Recommended)** — staff set
  "Cairo → Alexandria" once and override only where it differs, instead of pricing every area pair.
- c) Like b, but only one end walks (the drop-off), the pickup must match exactly.

**P2. Directions and return legs.**
- a) Rows are one direction; creation can add both directions at once (`bothWays`), and a return leg prices from the
  reverse row. **(Recommended)** — matches the schema and lets the airport run cost more one way.
- b) Like a, but when the reverse row is missing the return leg falls back to the forward price.
- c) Rows are symmetric: one row serves both directions (lookup tries both orders).

**P3. A pickup and drop-off in the same place** (e.g. both resolve to Maadi, a trip within Cairo).
- a) Allowed when a row exists with `fromId = toId` (P1's walk-up applies, so "Cairo → Cairo" covers all of Cairo).
  **(Recommended)**
- b) Not bookable.

**P4. Surcharges and discounts** (return discount, night trips, extra stops, extra luggage).
- a) None: the price is the row's price; staff adjust `totalPrice` by hand when needed (B10). **(Recommended)** — keep
  checkpoint 1 simple; add rules once the client asks for specific ones.
- b) A fixed percentage discount on return legs, configurable.
- c) A rules table (time-of-day and return modifiers).

**P5. Price history.** Trips already keep what they were charged, so history only answers "who changed this and when".
- a) Via the audit log (X1 b), with before and after. **(Recommended)**
- b) A `PricingHistory` table shown in the dashboard.

---

## Q. Quotes

| Method | Path | Audience | Permission |
| --- | --- | --- | --- |
| POST | `/v1/site/quotes` | public | — (rate limited) |
| POST | `/v1/staff/quotes` | staff | `trips` |

**Q1. What a quote takes.**
- a) Two pins (pickup, drop-off) plus passengers, luggage and an optional return date; the server resolves each pin to its
  most specific covered location (L7). **(Recommended)** — the trip stores the pin anyway, and it avoids a pin that
  contradicts a chosen location.
- b) A location id plus a pin for each end; the server checks the pin falls inside that location's coverage.

**Q2. What a quote returns.**
- a) Every active class × car body with a price for the route, each marked whether it fits the passengers and luggage
  (B4), plus the resolved pickup and drop-off names and, if asked, the return leg's price. **(Recommended)** — one
  call fills the whole "choose your ride" step.
- b) One price for a given class and body.

**Q3. No price for the route.**
- a) Not bookable online: the quote says `priced: false` and the site shows the company's phone and WhatsApp.
  **(Recommended)** — keeps `totalPrice` required and avoids a customer-acceptance step.
- b) Bookable as "price on request": `totalPrice` becomes nullable (with a CHECK that a confirmed trip has one), staff set
  the price, the customer accepts it before confirmation.

**Q4. Price lock between quote and booking.**
- a) Stateless: booking recomputes the price and takes the price the customer saw (`expectedPrice`); if it changed, the
  booking fails with `PRICE_CHANGED` and the new price. **(Recommended)** — no quote table, no stale locks.
- b) Persist quotes with a token valid 30 minutes; booking references the token and gets that price.

---

## B. Booking

| Method | Path | Audience | Permission |
| --- | --- | --- | --- |
| POST | `/v1/site/trips` | customer or verified guest | — |
| GET | `/v1/site/trips?status&cursor` | customer or verified guest | — |
| GET | `/v1/site/trips/{id}` | customer or verified guest | — |
| POST | `/v1/site/trips/{id}/cancel` | customer or verified guest | — |
| POST | `/v1/staff/trips` | staff | `trips` |
| GET | `/v1/staff/trips?status&from&to&q&driverId&vehicleId&officeId&unassigned&cursor` | staff | `trips` |
| GET | `/v1/staff/trips/{id}` (with events, report, linked trips) | staff | `trips` |
| PATCH | `/v1/staff/trips/{id}` | staff | `trips` |
| GET | `/v1/staff/overview` (today, tomorrow, unassigned, in progress, awaiting report) | staff | `trips` |

**B1. Booking fields.** Required: class, car body, pickup and drop-off pins, pickup date and time, passengers (≥ 1),
small/medium/large luggage (≥ 0), `expectedPrice` (Q4). Optional: notes (≤ 500 chars), a return leg (R1).
`clientName`/`clientPhone` (the passenger):
- a) Default to the booker's name and phone, editable so someone can book for another person. **(Recommended)**
- b) Always the booker's; no booking for others.
- c) Always entered separately.

**B2. Pickup time rules.**
- a) Customers and guests: at least **3 hours** ahead, at most **90 days** ahead, on a 15-minute grid. Staff: any future
  time, plus the past only with an explicit `backdated: true` (recording a trip that already happened). **(Recommended)**
- b) Same, with a **24-hour** lead time for customers.
- c) Your numbers: lead time ___, horizon ___, grid ___.

**B3. Must the drop-off be covered too?** The decision rejects pins outside coverage; this confirms it applies to both
ends.
- a) Both ends must be covered. **(Recommended)** — pricing needs a location at each end.
- b) Only the pickup; a drop-off outside coverage uses its nearest covered location for pricing.

**B4. Passenger and luggage limits per car body.** Car bodies are fixed in code, so the limits live in contracts and in a
`Trip_fits_car` CHECK. Proposed (placeholders — please give the real ones):

| Body | Passengers | Large | Medium | Small |
| --- | --- | --- | --- | --- |
| SEDAN | 4 | 2 | 1 | 2 |
| SUV | 6 | 3 | 2 | 3 |
| MINIVAN | 7 | 4 | 3 | 4 |
| VAN | 14 | 8 | 6 | 8 |

- a) Separate caps per size as above. **(Recommended)** — easy to explain on the site.
- b) Passengers cap plus a luggage points budget (small 1, medium 2, large 3).
- c) Passengers only; luggage is informational.

**B5. Limits on open bookings** (abuse, especially guests).
- a) At most 5 PENDING trips per customer or guest; staff unlimited. **(Recommended)**
- b) No limit.

**B6. Staff booking for a registered customer.** One booker is allowed per trip.
- a) Staff can pick an existing customer (search by phone or email): booker = that customer, `source = STAFF`, the
  "created" event's actor = the staff member, so it appears in the customer's account. Otherwise booker = the staff
  member. **(Recommended)**
- b) Staff bookings always have the staff member as booker; customers never see them online.

**B7. Trip code format.**
- a) `TRH-7K3Q9P`: prefix plus 6 characters from an alphabet without look-alikes (no 0/O, 1/I/L), random, retried on
  collision. **(Recommended)** — easy to read over the phone, reveals nothing about volume.
- b) Date-based: `2611-4821` (yymm + 4 digits).
- c) Sequential: `TRH-000123`.

**B8. Payment.** There's no payment model.
- a) Out of scope: `totalPrice` only; payment happens offline.
- b) Track it on the trip: `paymentMethod` (CASH_TO_DRIVER, CASH_AT_OFFICE, TRANSFER, CARD later) and `paidAt`, set by
  staff (and by the driver's report for cash). **(Recommended)** — cash collected by drivers feeds the driver balance
  (D8), and analytics can show unpaid trips.
- c) A payments table (several payments per trip, refunds).

**B9. Double submission.**
- a) Booking requires an `Idempotency-Key` header; a repeat with the same key from the same booker returns the first
  trip instead of creating another (stored as a unique column on `Trip`). **(Recommended)** — "no lost bookings, no
  double bookings" from the architecture principles; bad mobile connections retry.
- b) No idempotency; rely on the UI disabling the button.

**B10. Editing a trip.**
- a) Staff can change date, pins, class, body, passengers, luggage, notes, client name and phone, and `totalPrice` while
  PENDING or CONFIRMED (each change recorded with before and after); `totalPrice` stays editable until COMPLETED.
  Customers can't edit — they cancel and rebook, or call. **(Recommended)**
- b) Like a, and customers can change date and notes while PENDING.
- c) No edits; cancel and rebook only.

Changing the route, class or body doesn't reprice automatically under a; the dashboard shows the new estimate and staff
choose.

**B11. Guest access to their trips.** A guest session lasts 30 days and a browser holds one guest.
- a) A verified guest sees only the trips booked in this session.
- b) A verified guest sees every guest trip booked with the same verified email (verification proves they own it).
  **(Recommended)** — someone who books twice from two devices, or comes back after 30 days, still finds their trips.
- c) b, plus a "find my booking" form: trip code + email → emailed code → session.

---

## T. Trip status lifecycle

Statuses: PENDING, CONFIRMED, IN_PROGRESS, AWAITING_REPORT, COMPLETED, CANCELLED. Every move is a conditional update on
the current status (so two people can't both win) and writes a `TripEvent`.

| Method | Path | Audience | Permission |
| --- | --- | --- | --- |
| POST | `/v1/staff/trips/{id}/confirm` | staff | `trips` |
| POST | `/v1/staff/trips/{id}/start` | staff | `trips` |
| POST | `/v1/staff/trips/{id}/end` | staff | `trips` |
| POST | `/v1/staff/trips/{id}/complete` | staff | `trips` |
| POST | `/v1/staff/trips/{id}/cancel` | staff | `trips` |

**T1. What confirming means.**
- a) An explicit staff action ("we accept this booking"), independent of assignment; the customer is told it's confirmed,
  driver details follow when assigned. **(Recommended)** — the company can accept a booking days ahead before choosing a
  driver.
- b) Automatic when a driver and vehicle (or an office) are assigned, back to PENDING when unassigned (Rehletak).
- c) Explicit, but only allowed once assigned.

**T2. Starting requires.**
- a) A driver and a vehicle, or an office (A4). **(Recommended)**
- b) A driver and a vehicle, even for office trips.

**T3. How a trip starts and ends.**
- a) Staff only, by hand.
- b) Staff, or the driver from the report link ("Start trip", "End trip", which also fill `startedAt`/`endedAt`).
- c) Fully by time: IN_PROGRESS at the pickup time, AWAITING_REPORT N hours later.
- d) b, plus a safety net job (`advance-overdue-trips`): a CONFIRMED, assigned trip still not ended 12 hours after its
  pickup time moves to AWAITING_REPORT (system actor). **(Recommended)** — real timestamps when the driver uses the
  link, and nothing gets stuck when nobody does.

**T4. Completing.**
- a) Staff review the submitted report and complete the trip; that's when it affects the driver's balance (D8).
  **(Recommended)**
- b) Automatic when the driver submits the report.

**T5. Unconfirmed trips near pickup.**
- a) A job cancels PENDING trips still unconfirmed at their pickup time (system actor `expire-pending-trips`), notifying
  the booker and staff. **(Recommended)**
- b) Cancel 1 hour before pickup.
- c) Never automatic; they show as overdue in the overview.

**T6. Customer cancellation.**
- a) PENDING: any time. CONFIRMED: until **24 hours** before pickup; after that the site says to call. Reason optional.
  **(Recommended)**
- b) Until 6 hours before pickup.
- c) PENDING only; confirmed trips are cancelled by staff.

**T7. Staff cancellation.**
- a) PENDING, CONFIRMED or IN_PROGRESS (a no-show or breakdown), with a required reason from a short list (customer
  request, no-show, no vehicle, duplicate, other + text). **(Recommended)**
- b) PENDING or CONFIRMED only, reason free text and optional.

**T8. Going backwards.**
- a) No backward moves, except staff undoing a mistaken start (IN_PROGRESS → CONFIRMED) and reopening a report
  (COMPLETED → AWAITING_REPORT) before the month's report is generated. Cancelled is final. **(Recommended)**
- b) Strictly forward; mistakes are fixed by cancelling and rebooking.

---

## A. Assignment

| Method | Path | Audience | Permission |
| --- | --- | --- | --- |
| PUT | `/v1/staff/trips/{id}/assignment` (`driverId`, `vehicleId`, `officeId`, `acknowledgeConflicts`) | staff | `trips` |
| GET | `/v1/staff/trips/{id}/assignment/candidates` (drivers and vehicles with conflicts flagged) | staff | `trips` |

**A1. When assignment can change.** a) PENDING and CONFIRMED only; reassigning a confirmed trip notifies the customer and
rotates the report link (D2). **(Recommended)** b) Also during IN_PROGRESS (a breakdown mid-trip).

**A2. Vehicle must fit the trip** (needs F1).
- a) The vehicle's body must equal the trip's `car`. **(Recommended)** — the customer was quoted for that body.
- b) Equal or larger (an upgrade); a smaller one is refused.
- c) No check.

**A3. Double booking.** Trips have a pickup time but no end time, so a true overlap can't be computed.
- a) Hard rule in the database: a driver or vehicle can't be on two IN_PROGRESS trips at once (partial unique indexes).
  Soft rule in the app: any other live trip (PENDING, CONFIRMED, IN_PROGRESS) for the same driver or vehicle within
  **±6 hours** of this pickup returns `409 ASSIGNMENT_CONFLICT` listing them, unless `acknowledgeConflicts: true`.
  **(Recommended)** — catches real clashes, allows an airport run in the morning and another in the afternoon.
- b) a, but the soft rule blocks (no override).
- c) Add an estimated duration (per pricing row) and block real overlaps with an exclusion constraint.
- d) No checks.

**A4. Handing a trip to an office.**
- a) Setting `officeId` makes driver and vehicle optional; any that are set must belong to that office (enforced by a
  trigger, `Trip_assignment_matches_office`). Starting needs only the office. **(Recommended)**
- b) An office trip never has a driver or vehicle recorded.
- c) An office trip must still name the driver and vehicle before it starts.

**A5. Who can be assigned.** Archived drivers, vehicles and offices (F2, O4) are refused.
Confirm: a) yes **(Recommended)**.

**A6. What the customer sees.**
- a) Once confirmed and assigned: driver's first name and phone, vehicle make, model, color and plate; for an office trip,
  the same if recorded, otherwise "operated by a partner". **(Recommended)**
- b) Only from 24 hours before pickup.
- c) Never; the company calls them.

---

## R. Return and linked trips

**R1. Booking a return.**
- a) The booking takes an optional `return { pickupDate, pickup?, dropoff? }`; it creates two trips in one transaction,
  each with its own code, the return reversed by default, linked by `previousTripId`. **(Recommended)** — each leg
  has its own driver, report and status.
- b) One trip with a return date, one report.

**R2. Return leg defaults.** Same class, body, passengers and luggage, pins reversed; the customer can change the return
pins (a different hotel, say) but not the class or body. a) As stated **(Recommended)**; b) everything editable per leg.

**R3. Cancelling one leg.**
- a) Customers cancel the booking as a whole (both legs, unless the outbound already started, then only the return);
  staff cancel per leg. **(Recommended)**
- b) Each leg independently for everyone.
- c) Cancelling the outbound always cancels the return.

**R4. Linking existing trips.**
- a) Only at booking time.
- b) Staff can also link and unlink two trips later (`POST/DELETE /v1/staff/trips/{id}/link`), for a return booked by
  phone later. **(Recommended)**

---

## D. Driver report

| Method | Path | Audience | Permission |
| --- | --- | --- | --- |
| POST | `/v1/staff/trips/{id}/report-link` (issue or rotate; returns the link once) | staff | `trips` |
| GET | `/v1/site/driver/report` (token in header) | driver link | — |
| POST | `/v1/site/driver/report/start`, `/end` (if T3 b or d) | driver link | — |
| PUT | `/v1/site/driver/report` (save or submit) | driver link | — |
| GET | `/v1/staff/trips/{id}/report` | staff | `trips` |
| PUT | `/v1/staff/trips/{id}/report` (staff fill or correct) | staff | `trips` |

**D1. How a driver gets in.** The trip code is printed on the customer's confirmation, so it isn't a secret.
- a) Trip code alone (today's plan).
- b) A per-trip random token (32 bytes) in a link, `terhal.co/report#<token>`; only its hash is stored, it's tied to the
  trip and the assigned driver, expires 7 days after pickup, is revoked when the driver changes, and is rate limited.
  The token sits in the URL fragment, so it never reaches server logs; the page sends it in a header.
  **(Recommended)** — unguessable, scoped to one trip, nothing for the driver to remember.
- c) b plus a second factor: the last 4 digits of the driver's phone.
- d) Trip code plus a one-time code sent to the driver's phone (needs WhatsApp or SMS, not integrated).

**D2. Delivering the link.**
- a) Staff press "Send report link": the dashboard opens a WhatsApp click-to-chat (`wa.me/<driver phone>`) with the link
  prefilled, or copies it; issued automatically on assignment. **(Recommended)** — works today without a WhatsApp
  provider; drivers aren't notification recipients.
- b) Wait for the WhatsApp Cloud API and send it automatically.

**D3. Report fields and rules.** Schema fields: start time, where the vehicle was picked up, start mileage, pickup and
drop-off times, where the vehicle was returned, end time, end mileage, stops, expenses.
- a) All required on submit; CHECKs for `startedAt ≤ pickupAt ≤ dropoffAt ≤ endedAt`, `endMileage ≥ startMileage`,
  amounts > 0, a stop's start ≤ end. Drafts save partial data on the page only (browser), submit writes the report.
  **(Recommended)**
- b) Server-side drafts: make the columns nullable and add `submittedAt`, so a driver can fill it across devices.

**D4. Stops' coordinates.** `TripStop` requires latitude and longitude, but a driver may only know a name.
- a) Keep required: the page fills them from the phone's location ("I'm here") or a map pin. **(Recommended)**
- b) Make them optional; address only is enough.

**D5. Expenses: who paid.**
- a) Add `paidBy` (DRIVER, COMPANY) to `TripExpense`; only driver-paid expenses are reimbursed (D8). **(Recommended)**
- b) Every expense on a report is assumed paid by the driver.

**D6. Receipts.** a) No attachments for now. **(Recommended)** — needs storage (F4) and the client hasn't asked.
b) Optional photo per expense.

**D7. Editing after submission.**
- a) The driver can edit until staff complete the trip; staff can edit until completion; after that only by reopening
  (T8). Every submission and edit is a trip event. **(Recommended)**
- b) Locked for the driver once submitted; staff only.

**D8. Driver balance (`amountOwed`).** Today it's a bare number with no default and no defined direction.
- a) Meaning: what the company owes the driver (negative when the driver holds company cash). Add a `DriverTransaction`
  ledger (trip fee, reimbursed expenses, cash collected, payout, manual adjustment; each with amount, trip, staff, note),
  and keep `amountOwed` as its running total, default 0, updated in the same transaction. On completion: + `DRIVER_FEE`
  and driver-paid expenses, − cash collected (B8). Staff record payouts and adjustments. **(Recommended)** — every
  change to money owed is explainable.
- b) Same meaning, but only the number: completion adds to it, staff edit it directly (audited).
- c) Drop `amountOwed`; compute balances from reports in analytics.

Applies to internal drivers too? a) Only external drivers get trip fees; internal drivers still get reimbursements and
cash collected. **(Recommended)** b) Same for all drivers.

**D9. Office trips.**
- a) The office's driver fills the report through the same link if a driver is recorded; otherwise staff fill it or
  complete without one (the report is optional for office trips). **(Recommended)**
- b) Office trips always skip the report: CONFIRMED → IN_PROGRESS → COMPLETED.

---

## F. Fleet (drivers, vehicles)

| Method | Path | Audience | Permission |
| --- | --- | --- | --- |
| GET | `/v1/staff/drivers?q&external&officeId&archived&cursor` | staff | `fleet` or `trips` |
| POST | `/v1/staff/drivers` | staff | `fleet` |
| GET / PATCH | `/v1/staff/drivers/{id}` | staff | `fleet` (GET: or `trips`) |
| POST | `/v1/staff/drivers/{id}/archive`, `/restore` | staff | `fleet` |
| GET | `/v1/staff/drivers/{id}/trips` | staff | `fleet` or `trips` |
| GET / POST | `/v1/staff/drivers/{id}/transactions` (payouts, adjustments; D8 a) | staff | `fleet` |
| GET | `/v1/staff/vehicles?q&body&external&officeId&archived&cursor` | staff | `fleet` or `trips` |
| POST | `/v1/staff/vehicles` | staff | `fleet` |
| GET / PATCH | `/v1/staff/vehicles/{id}` | staff | `fleet` (GET: or `trips`) |
| POST | `/v1/staff/vehicles/{id}/archive`, `/restore` | staff | `fleet` |
| POST | `/v1/staff/vehicles/{id}/images` (multipart) | staff | `fleet` |
| DELETE | `/v1/staff/vehicles/{id}/images/{imageId}` | staff | `fleet` |
| PUT | `/v1/staff/vehicles/{id}/images/order` | staff | `fleet` |

**F1. Vehicle body and capacity.**
- a) Add `Vehicle.body CarBody` (required); capacity comes from the body (B4). **(Recommended)**
- b) Add `body` plus per-vehicle seats and luggage overriding the body's defaults.

**F2. Removing drivers and vehicles.**
- a) Add `archivedAt` to both, like offices; archiving is blocked while they're on an upcoming live trip.
  **(Recommended)**
- b) Hard delete, failing when trips reference them.

**F3. Extra driver fields.**
- a) None beyond the schema.
- b) Licence number and licence expiry (the dashboard warns 30 days before expiry), national ID optional.
  **(Recommended)** — it's what operators check before assigning.

**F4. Where images (and later receipts and monthly reports) are stored.** `VehicleImage` and `AnalyticsDocument` have
`bucket` and `key`.
- a) Cloudflare R2 (S3 API, private bucket); uploads go through the API (type sniffed from bytes, size checked), and
  reads use short-lived signed URLs. **(Recommended)** — no storage on the VPS (moving servers stays trivial), and
  it's already the planned integration.
- b) R2 with direct browser uploads to a presigned URL, confirmed afterwards.
- c) A Docker volume on the VPS.
- d) In Postgres (`bytea`).

**F5. Image rules.** a) JPEG, PNG or WebP, ≤ 5 MB each, at most 8 per vehicle, ordered, the first is the cover.
**(Recommended)** b) Your limits.

**F6. Do customers see vehicle photos?** a) Yes, the cover photo with the assigned vehicle (A6). b) No, staff only.
**(Recommended)** — photos may show plates and the office's branding; add later if wanted.

---

## O. Offices

| Method | Path | Audience | Permission |
| --- | --- | --- | --- |
| GET | `/v1/staff/offices?q&archived&cursor` | staff | `fleet` or `trips` |
| GET | `/v1/staff/offices/nearby?latitude&longitude` | staff | `fleet` or `trips` |
| POST | `/v1/staff/offices` | staff | `fleet` |
| GET / PATCH | `/v1/staff/offices/{id}` (detail with drivers, vehicles, trips) | staff | `fleet` (GET: or `trips`) |
| POST | `/v1/staff/offices/{id}/archive`, `/restore` | staff | `fleet` |

**O1. What the business pays an office for a trip.** There's no field for it, so margins on handed-off trips are unknown.
- a) Add `Trip.officeCost` (set when handing off, editable until completion), used by analytics. **(Recommended)**
- b) Record it as an expense on the report.
- c) Don't track it.

**O2. Telling the office.**
- a) Staff contact the office themselves (the dashboard shows phone, email, WhatsApp link). **(Recommended)** —
  offices aren't notification recipients and have no accounts.
- b) Email the office the trip details on handoff (needs an office recipient on `Notification`).

**O3. "Nearby" offices for a pickup.**
- a) Offices whose location is the pickup's location or one of its ancestors or descendants, nearest first.
  **(Recommended)**
- b) Straight-line distance from the office location's center.
- c) Skip nearby; a plain list.

**O4. Archiving an office.** a) Blocked while it has upcoming live trips; its drivers and vehicles stay but can't be
assigned through it. **(Recommended)** b) Allowed any time; archives its drivers and vehicles too.

---

## U. Customers (as staff and admins see them)

| Method | Path | Audience | Permission |
| --- | --- | --- | --- |
| GET | `/v1/staff/customers?q&status&cursor` | staff | `customers` or `trips` |
| GET | `/v1/staff/customers/{id}` (with trip count and total spent) | staff | `customers` |
| GET | `/v1/staff/customers/{id}/trips` | staff | `customers` |
| GET | `/v1/admin/customers?q&status&cursor`, `/{id}`, `/{id}/trips` | admin | — |
| POST | `/v1/admin/customers/{id}/suspend`, `/reactivate` | admin | — |

Suspend and reactivate are admin-panel only (X5 answer); staff only view.

**U1. Search.** Name, phone, email (X8 normalization), filter by status. Confirm: a) yes **(Recommended)**.

**U2. Suspending a customer.**
- a) Ends their sessions and blocks sign in and booking; their upcoming trips stay as they are and staff decide; a
  reason is required and kept (audit). **(Recommended)**
- b) Also cancels their upcoming PENDING trips.

**U3. Editing a customer's details.**
- a) Staff and admins can't; customers own their details. **(Recommended)**
- b) Staff can fix name and phone (audited).

**U4. Guests in the customers list.**
- a) No; guest trips are found through trip search (name, phone, code). **(Recommended)**
- b) A separate "guests" list grouped by verified email.

**U5. Customer self-service** (the identity module has no profile or password-change routes yet): edit name, change
phone or email (re-verified), change password, list and end sessions.
- a) Include in this work, under `/v1/site/account/*`. **(Recommended)** — a customer site with bookings needs it.
- b) Later.

---

## M. Team

| Method | Path | Audience | Permission |
| --- | --- | --- | --- |
| GET | `/v1/staff/team?q&status` | staff | `team` |
| GET | `/v1/staff/team/{id}` | staff | `team` |
| PUT | `/v1/staff/team/{id}/permissions` | staff | `team` |
| POST | `/v1/staff/team/{id}/suspend`, `/reactivate` | staff | `team` |
| DELETE | `/v1/staff/team/{id}` | staff | `team` |
| GET | `/v1/staff/invitations` | staff | `team` |
| DELETE | `/v1/staff/invitations/{id}` | staff | `team` |
| POST | `/v1/staff/invitations/{id}/resend` | staff | `team` |
| PATCH | `/v1/staff/account` (own name, phone) | staff | — |
| POST | `/v1/staff/auth/password` (change own, ends other sessions) | staff | — |
| GET / DELETE | `/v1/staff/auth/sessions…` | staff | — |
| (same as team) | `/v1/admin/staff…` | admin | — |

**M1. Guard rails.**
- a) Nobody changes their own permissions, suspends or deletes themselves; there must always be one active staff member
  holding `team` (rows locked, like the last admin); suspending or a permission change takes effect on the next
  request (already how `requireStaff` works). **(Recommended)**
- b) Only the self rules; no last-`team` protection (admins can always recover).

**M2. Granting permissions.**
- a) A staff member can grant only permissions they hold. **(Recommended)** — `team` alone can't escalate to
  `pricing`.
- b) Anyone with `team` can grant any permission.

**M3. Deleting staff.**
- a) Soft: status DELETED, sessions ended, row kept for trips and events; their email is freed (rewritten to a
  placeholder) so they can be re-invited later. **(Recommended)**
- b) Soft, email kept (can't re-invite the same address).
- c) No delete, suspend only.

---

## N. Notifications

| Method | Path | Audience | Permission |
| --- | --- | --- | --- |
| GET | `/v1/staff/notifications?unread&cursor` | staff | — |
| GET | `/v1/staff/notifications/unread-count` | staff | — |
| POST | `/v1/staff/notifications/{id}/read` | staff | — |
| POST | `/v1/staff/notifications/read-all` | staff | — |
| (same, if N3 b) | `/v1/site/notifications…` | customer or guest | — |

**N1. Who is told what.** Proposed (email = the booker's email; staff = in-app to every active staff member with
`trips`):

| Event | Booker (customer/guest) | Staff |
| --- | --- | --- |
| Booked (by them) | email: received, with code | in-app |
| Booked by staff for a customer | email | — |
| Confirmed | email | — |
| Driver/vehicle assigned or changed | email (A6 details) | — |
| Reminder 24 h before pickup | email | — |
| Cancelled by staff or system | email with reason | in-app (system only) |
| Cancelled by the customer | email receipt | in-app |
| Pickup in 2 h and still unassigned | — | in-app |
| Report submitted by a driver | — | in-app |
| Completed | email: thank you | — |

- a) As above. **(Recommended)**
- b) As above, minus the reminder and completion emails (fewer emails on Resend's 100/day free plan).
- c) Your changes.

**N2. Where they go once WhatsApp is integrated.** a) Customer messages move to WhatsApp with email as fallback;
the schema already allows it, so no route changes now. **(Recommended)** b) Both channels always.

**N3. In-app inbox for customers.**
- a) Staff only for now; customers get email and see their trip's status on the site. **(Recommended)**
- b) Customers and guests too.

**N4. Delivery.** All sends go through the worker (BullMQ), with deterministic job ids per event and recipient, retries
with backoff and the delivery row updated; reminders are delayed jobs rescheduled when the pickup time changes.
Confirm: a) yes **(Recommended)**.

**N5. Language.**
- a) Add `locale` (`ar`, `en`; default `ar`) to `Customer` and `GuestSession`, taken from the site's locale cookie at
  sign-up or booking, and editable in the account; staff notifications in each staff member's locale (also a column).
  **(Recommended)**
- b) Every email in both languages, Arabic first.

**N6. Freshness in the dashboard.**
- a) The dashboard polls the unread count every 30 seconds. **(Recommended)** — simple, works behind Caddy, no
  sticky connections.
- b) Server-sent events.

---

## Y. Analytics

| Method | Path | Audience | Permission |
| --- | --- | --- | --- |
| GET | `/v1/staff/analytics?from&to&groupBy` | staff | `analytics` |
| GET | `/v1/staff/analytics/reports` (monthly documents) | staff | `analytics` |
| GET | `/v1/staff/analytics/reports/{year}/{month}` (signed download URL) | staff | `analytics` |
| POST | `/v1/staff/analytics/reports/{year}/{month}/regenerate` | staff | `analytics` |
| GET | `/v1/staff/exports/trips.csv?from&to&status…` | staff | `analytics` or `trips` |
| GET | `/v1/staff/exports/{drivers,vehicles,customers,pricing}.csv` (Y4 b) | staff | `analytics` |

**Y1. Metrics on the analytics page.**
- a) For a date range (by pickup date, Cairo days): trips, revenue, average fare, cancellation rate, by status; a
  trend by day/week/month; breakdowns by class, car body, source (online vs staff) and top 10 routes (by governorate
  pair); fleet: trips per driver and vehicle, in-house vs office; costs: report expenses by type, office costs (O1),
  driver balances outstanding; margin = revenue − expenses − office costs. **(Recommended)**
- b) a without costs and margin.
- c) Only totals and the trend (Rehletak).

**Y2. What counts as revenue.**
- a) `totalPrice` of COMPLETED trips; "booked value" (every non-cancelled trip) shown separately. **(Recommended)**
- b) Every non-cancelled trip (Rehletak).

**Y3. The monthly `AnalyticsDocument`.**
- a) On the 2nd of each month (Cairo), a job writes the previous month's report as an XLSX workbook (summary sheet with Y1
  figures, then trips, expenses, driver transactions, office costs), stored under F4 and listed in the dashboard;
  staff can regenerate a month. **(Recommended)** — accountants want spreadsheets; a summary sheet keeps it readable.
- b) A PDF summary only.
- c) CSV files (one per sheet) in a zip.

**Y4. On-demand exports.**
- a) Trips CSV for any range and filter, streamed synchronously, capped at 50,000 rows. **(Recommended)**
- b) Also drivers, vehicles, customers and pricing CSVs.
- c) No on-demand exports; the monthly document only.

---

## Build order (checkpoint 1: customer booking plus staff running trips)

1. Cross-cutting: X1, X2 schema; any-of permission helper (X6); search normalization (X8).
2. Locations (admin CRUD, coverage, public and staff listing).
3. Trip classes, then pricing (P), then quotes (Q).
4. Booking: site (customer and guest) and staff; trip list, detail, overview.
5. Lifecycle and assignment, fleet and offices as far as assignment needs them, then return trips.
6. Driver report and driver balance.
7. Notifications (email to bookers, staff inbox).
8. Customers, team management, customer self-service.
9. Analytics, exports and the monthly document (needs storage).

## Schema changes the recommended answers imply

Folded into the domain migrations (with a drift check):

- `admin`: `AuditLog.staffId` + `AuditLog_one_actor` (X1).
- `locations`: sibling-name partial unique indexes (L2); `Location_parent_broader` trigger (L1); search columns (X8).
- `staff`: `Staff.locale` (N5).
- `customers`: `Customer.locale`, `GuestSession.locale` (N5).
- `fleet`: `Vehicle.body` (F1); `archivedAt` on `Driver` and `Vehicle` (F2); driver licence fields (F3);
  `amountOwed` default 0 + `DriverTransaction` ledger (D8); `VehicleImage.position` (F5).
- `trips`: `TripClass` description and `sortOrder` (C1) + active-name unique indexes (C2); `TripEvent.data` (X2);
  `Trip.paymentMethod`, `paidAt` (B8); `Trip.idempotencyKey` (B9); `Trip.officeCost` (O1); report token hash and expiry
  (D1); `TripExpense.paidBy` (D5); CHECKs `Trip_fits_car` (B4), report chronology and mileage (D3), amounts > 0 (X3);
  partial unique indexes for one IN_PROGRESS trip per driver and per vehicle (A3);
  `Trip_assignment_matches_office` trigger (A4).
- `pricing`: price > 0 CHECK (X3); `Pricing_*` indexes for the walk-up lookup (P1).

---

## Answers

Recorded as they arrive. Sections not listed here are still open.

### X. Cross-cutting (answered 2026-11-21)

- **X1 → b.** `AuditLog` gets `staffId` and an `AuditLog_one_actor` check. Staff actions are audited and shown only in the admin panel.
- **X2 → b.** `TripEvent.data Json`, with action names from a fixed list in contracts.
- **X3 → a.** EGP only, decimal strings in the API, CHECKs on amounts.
- **X4 → a.** `Africa/Cairo` on the server; ISO-8601 UTC in the API.
- **X5 → the recommended table, with two changes:**
  - Locations and coverage: full CRUD on the staff dashboard as well as the admin panel. The staff permission guarding location writes is proposed as `pricing` (pending confirmation).
  - Customers: the staff dashboard only views them (list, detail, their trips). Suspend and reactivate are admin-panel only.
- **X6 → a.** Read routes accept the owning permission or `trips`; writes need the owning permission (any-of helper).
- **X7 → a.** Redis rate limits now, Turnstile later.
- **X8 → b.** Normalized Arabic search columns.
- **X9 → a.** One route per action.

### L. Locations (answered 2026-11-21)

- **L1 → b.** The parent must be broader, and an area may sit directly under a governorate. Enforced by the `Location_parent_broader` trigger.
- **L2 → a.** Names are unique among live siblings, per language.
- **L3 → b, cascade.** Deleting a location soft-deletes its whole live subtree. Restoring brings back exactly what that delete removed, tracked with `deletedWithId` (proposed; see below).
- **L4 → a.** Deleting a location that's in use is allowed. The detail route returns usage counts.
- **L5 → a.** Moving is allowed, subject to L1 and L2.
- **L6 → a.** Restoring needs a live parent, and the name must still be free.
- **L7 → a.** Locality first, then the nearest center.
- **L8 → b, conditional on performance** (assessment below).
- **L9 → seed only.** A one-off seed script loads the 27 governorate outlines. No route or form edits outlines, for admins or staff. Creating and updating a governorate take names only, and `boundary` isn't writable through the API. This also answers the earlier question about staff editing outlines: nobody does.

**L3 proposal: `Location.deletedWithId`.** A nullable self-reference to the location whose delete removed this row; the root of a delete points at itself.
- A CHECK, `Location_deleted_with`, requires `deletedWithId` to be null exactly when `deletedAt` is null.
- Restoring the root restores every row with `deletedWithId = root.id` in one transaction, and clears both columns.
- A subtree deleted earlier, on its own, keeps its own `deletedWithId`, so restoring its parent leaves it deleted.
- Matching on equal `deletedAt` values was rejected. The timestamp is set by the app, so two separate deletes can share a millisecond, and timestamp equality is fragile.
- Under L6, only the root of a delete can be restored. Its descendants have a deleted parent until the root comes back. Only the root's name can clash with a live sibling: nothing can be created or moved under a deleted parent.

**L8 assessment.** The public tree is served in two parts:
- `GET /v1/site/locations`: the tree, meaning ids, parent, locality, names, center and radius.
- `GET /v1/site/locations/outlines`: the 27 outlines.

Outlines change only when the seed runs, so they can be cached as immutable.

Payload size:

| Part | Raw | Compressed |
| --- | --- | --- |
| Tree, 500 places at about 150 B each | ~75 KB | ~15–20 KB |
| Outlines, simplified (27 × at most 300 points × ~20 B) | ~160 KB | ~60–70 KB |
| Outlines, unsimplified (open data, thousands of points each) | several MB | not served this way |

Keeping it small:
- The seed simplifies each outline (Douglas–Peucker, tolerance about 0.001°, roughly 100 m) to at most 300 points.
- Coordinates are rounded to 5 decimals, about 1 m.
- Responses are compressed. Nothing compresses responses today, so Caddy's `encode zstd gzip` is added to the API host.
- Only active rows are included, with no timestamps.

Caching:
- **Tree:** the ETag is a hash of `max("updatedAt")` and the row count. Hard deletes never happen and soft deletes bump `updatedAt`, so any change invalidates it. That's one index-only query per request, and a match returns 304. The response is `Cache-Control: public, max-age=60, stale-while-revalidate=600`. The serialized body is kept in memory, keyed by that version.
- **Outlines:** the URL carries a version hash (`?v=<hash>` from the tree response), served with `Cache-Control: public, max-age=31536000, immutable`.

Server-side cost: the coverage check scans the active circles with a bounding-box prefilter and tests 27 polygons with `@>`. Both take well under a millisecond at this size.

When to switch to search plus coverage only: if the tree passes about 2,000 places or about 150 KB compressed (about 1 s on a slow 3G connection), the site stops loading the full tree. It would then use server-side search plus the coverage check, and outlines stay a separate cached download. The contracts already allow this (staff search exists), so switching is a client change and needs no migration.

### C. Trip classes (answered 2026-11-21)

- **C1 → b.** Names, plus a bilingual description and a `sortOrder`.
- **C2 → a.** Active names are unique per language.
- **C3 → a.** Archiving keeps the class's pricing rows (inactive) and leaves trips untouched.

### P. Pricing (answered 2026-11-21)

- **P1 → b.** The lookup walks up the location tree; ties prefer the more specific pickup.
- **P2 → a.** Each row is one direction, with a `bothWays` option on create. A return leg is priced from the reverse row.
- **P3 → b. A trip whose pickup and drop-off are the "same place" is not bookable.** Proposed definition, pending confirmation: the same resolved location id. `fromId = toId` pricing rows stay allowed.
- **P4 → a.** No surcharges; staff adjust `totalPrice` by hand.
- **P5 → a.** Price history goes through the audit log.

### Q. Quotes (answered 2026-11-21)

- **Q1 → a.** Two pins, each resolved on the server.
- **Q2 → a.** Every class × body, with fit flags, plus the return leg's price.
- **Q3 → b. Price on request.** `totalPrice` becomes nullable, with a CHECK that a confirmed trip has a price. Staff set the price and the customer accepts it before confirmation. The proposed flow is below, pending confirmation.
- **Q4 → a.** Stateless: `expectedPrice` plus `PRICE_CHANGED`.

**Proposed price-on-request flow:**

- **Schema.** A new `Trip.priceState` enum with four values:
  - `QUOTED`: priced from the price list at booking.
  - `REQUESTED`: no price yet.
  - `PROPOSED`: staff set a price and the booker hasn't answered.
  - `ACCEPTED`: the booker accepted it.

  Two CHECKs:
  - `Trip_price_state`: `totalPrice` is null exactly when the state is `REQUESTED`.
  - `Trip_priced_before_confirmed`: a trip in any status other than `PENDING` or `CANCELLED` must be `QUOTED` or `ACCEPTED`.

  The `TripStatus` enum doesn't change.
- **Quote.** An option without a matching row comes back with `price: null`. Fit flags apply as usual.
- **Booking (Q4).** The server recomputes the price.
  - Priced options need `expectedPrice`, and unpriced ones must leave it out.
  - Any mismatch fails with `PRICE_CHANGED`, giving the current price, which may be null. This includes a route that gained a price since the quote.
  - An unpriced trip is created as `PENDING` / `REQUESTED` and counts toward the B5 cap.
- **Staff propose a price.** `POST /v1/staff/trips/{id}/price { totalPrice, note? }` (`trips`).
  - Allowed while the trip is `REQUESTED` or `PROPOSED`; proposing again replaces the earlier price.
  - It records a trip event and emails the booker an accept link.
  - If the booker is a staff member (a phone booking), the state goes straight to `ACCEPTED`: the customer agreed on the phone.
- **The booker answers.**
  - `POST /v1/site/trips/{id}/price/accept { expectedPrice }` accepts. `expectedPrice` must equal the current proposal, so a replaced proposal can't be accepted by mistake; otherwise `PRICE_CHANGED`.
  - `POST /v1/site/trips/{id}/price/decline { reason? }` cancels the trip, with the booker as the actor.
  - Guests use the same routes through their verified session. Under B11 (b), a guest who comes back with the same verified email still finds the trip.
- **T1 (confirming).** Staff can confirm only a `QUOTED` or `ACCEPTED` trip, and the CHECK above enforces it. After confirmation, editing `totalPrice` (B10, P4) needs no new acceptance.
- **Expiry.** The T5 job also cancels `REQUESTED` and `PROPOSED` trips that are still pending at their pickup time.
- **Return legs.** Each leg has its own price state. The site shows both legs together, and "Accept" accepts every proposed leg of the booking in one call. Declining the outbound leg cancels both, as in R3 a.
- **Notifications.**
  - The booker gets an email when a price is proposed, plus a reminder 24 hours before pickup if they still haven't answered.
  - Staff get in-app notices for "price requested", "accepted" and "declined".

### Follow-ups and remaining sections (answered 2026-11-21)

Anything not listed takes the recommended option.

**Settled follow-ups:**
- **P3 → a.** "Same place" means the same resolved location id (`QUOTE_SAME_PLACE`). Pricing rows with `fromId = toId` stay allowed, and the editor refuses an area priced to itself.
- **Q3 follow-ups:**
  - Staff can save a proposed price to the price list (`saveToPricing`, which needs `pricing`).
  - Staff can leave a trip unpriced only when booking for a customer.
  - A proposal lasts until the pickup time, with a reminder 24 hours before.
  - The quote shows every active class × body that fits, priced or not.
- **Governorates are seed-only.** The API only renames them: no create, no delete, no move, and `boundary` is never writable.
- **Large deletes:** a delete states `expectedCount`, the size of the live subtree including the location itself, and fails with `LOCATION_COUNT_MISMATCH` when it differs.
- **Outlines:** from geoBoundaries (ADM1, CC BY 4.0), with attribution on the site.
- **Staff location writes** need `pricing`.
- **`customers`** is a view-only permission covering customer details and trip history. Suspend and reactivate are admin-only.
- **Deploy:** no change to Caddy or `deploy/` in this work. Compressing the location tree waits for a separate deploy change.

**B. Booking**
- B1 a, B2 a, B3 a.
- **B4 a**, with separate caps per luggage size. The placeholder numbers become named constants in contracts. **The real numbers are still needed.**
- **B5: at most 3 PENDING trips** per customer or guest.
- B6 a, B7 a, B8 b, B9 a, B10 a, B11 b.

**T. Lifecycle**
- T1 a, T2 a, T3 d, T4 a, T5 a.
- **T6:** a customer can cancel a PENDING trip at any time. A CONFIRMED trip can never be cancelled by the customer online; the site tells them to call.
- T7 a, T8 a.

**A. Assignment**
- A1 a.
- **A2 b:** the vehicle's body must be the trip's `car` or larger, using the size order SEDAN < SUV < MINIVAN < VAN from contracts.
- **A3 a, with a soft window of ±3 hours.**
- A4 a, A5 a, A6 a.

**R. Return trips:** R1 a, R2 a, R3 a, R4 b.

**D. Driver report**
- D1 b, D2 a, D3 a.
- **D4:** a stop has either an address or a pin, exactly one (`TripStop_address_or_pin`). Latitude and longitude are set together.
- **D5 b:** every expense is assumed paid by the driver; there's no `paidBy`.
- D6 a.
- **D7 b:** the report locks for the driver once submitted; after that only staff can edit it.
- **D8 a:** a ledger. Internal drivers get reimbursements and have cash collected deducted, but no trip fee.
- D9 a.

**F. Fleet**
- F1 a, F2 a, F3 b.
- F4 a: R2, uploaded through the API, read through signed URLs.
- **F5:** at most **5** images per vehicle. JPEG, PNG or WebP, up to 5 MB each, ordered, with the first as the cover.
- F6 b.

**O. Offices**
- **O1 b:** what an office is paid is an expense on the trip's report, with a new `ExpenseType` `OFFICE_FEE`. Office fees are never reimbursed to the driver and never enter the driver's ledger. There's no `Trip.officeCost`.
- O2 a, O3 a, O4 a.

**U. Customers:** U1 a, U2 a (admin-only), U3 a, U4 a, U5 a.

**M. Team:** M1 a. **M2 b:** anyone with `team` can grant any permission. M3 a.

**N. Notifications:** N1 as in the table, N2 a, N3 a, N4 a, N5 a, N6 a.

**Y. Analytics**
- Y1 a, Y2 a.
- **Y3 a, generated on the 1st** of each month (Cairo time), for the previous month.
- **Y4 a, plus b:** CSV exports of drivers, vehicles, customers and pricing.
- As built (details in [decisions.md](decisions.md), "Analytics: the details the spec left open"): the range is Cairo
  calendar days (`from` and `to` as `YYYY-MM-DD`, both included); costs and margin count completed trips' report
  expenses, office fees included; weeks start on Saturday; the trips CSV fails with `EXPORT_TOO_LARGE` over 50,000
  rows; regenerating is only for months that are over (`REPORT_MONTH_NOT_OVER`) and replaces the month's workbook in
  place.

### Agreed schema changes

Folded into the domain migrations:

- **`admin`:** `AuditLog.staffId` and `AuditLog_one_actor` (X1).
- **`locations`:**
  - `deletedWithId` and `Location_deleted_with` (L3);
  - partial unique indexes on sibling names (L2);
  - the `Location_parent_broader` trigger (L1);
  - normalized search columns (X8).
- **`staff`:** `Staff.locale` (N5).
- **`customers`:** `Customer.locale` and `GuestSession.locale` (N5); normalized search column (X8).
- **`fleet`:**
  - `Vehicle.body` (F1);
  - `archivedAt` on `Driver` and `Vehicle` (F2);
  - driver licence number and expiry, and an optional national ID (F3);
  - `amountOwed` default 0 and the `DriverTransaction` ledger (D8);
  - `VehicleImage.position` (F5).
- **`trips`:**
  - `TripClass` descriptions and `sortOrder` (C1), and unique active names (C2);
  - `TripEvent.data` (X2);
  - `Trip.priceState`, a nullable `totalPrice`, `Trip_price_state` and `Trip_priced_before_confirmed` (Q3);
  - `Trip.paymentMethod` and `Trip.paidAt` (B8);
  - `Trip.idempotencyKey` (B9);
  - the report token's hash and expiry (D1);
  - `ExpenseType.OFFICE_FEE` (O1);
  - a nullable stop address or pin, with `TripStop_address_or_pin` (D4);
  - CHECKs for car fit (B4), report chronology and mileage (D3) and positive amounts (X3);
  - one IN_PROGRESS trip per driver and per vehicle (A3);
  - the `Trip_assignment_matches_office` trigger (A4).
- **`pricing`:** a positive-price CHECK (X3).
