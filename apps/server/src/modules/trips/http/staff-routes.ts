import { createRoute } from "@hono/zod-openapi";
import {
  AssignTrip,
  AssignmentCandidates,
  CancelTrip,
  IdempotencyHeader,
  LinkTrips,
  ListTrips,
  ProposePrice,
  StaffBookTrip,
  StaffBooking,
  Trip,
  TripDetail,
  TripOverview,
  UpdateTrip,
  page,
} from "@terhal/contracts";
import { currentStaff } from "../../../platform/http/authenticate";
import { AppError } from "../../../platform/errors/app-error";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
import { assignTrip, assignmentCandidates } from "../application/assignment";
import { bookByStaff } from "../application/booking";
import { updateTrip } from "../application/edit";
import {
  cancelTrip,
  completeTrip,
  confirmTrip,
  endTrip,
  reopenTrip,
  startTrip,
  unstartTrip,
} from "../application/lifecycle";
import { linkTrips, unlinkTrip } from "../application/links";
import { proposePrice } from "../application/price-requests";
import { getTrip, listTrips, overview } from "../application/queries";
import { toTrip } from "../application/shared";
import {
  IdParam,
  invalid,
  notFound,
  staffActor,
  staffId,
  staffProblems,
  staffRead,
  staffSecurity,
  staffWrite,
  tags,
} from "./shared";

// The dashboard's trip routes. Every one needs `trips`.

const statusConflict = problemResponse(
  "TRIP_STATUS_CONFLICT (`tripStatus`): the trip isn't where this action applies.",
);

const book = createRoute({
  method: "post",
  path: "/staff/trips",
  tags,
  summary: "Book a trip",
  description: [
    "For an existing customer (`customerId`: the customer is the booker and sees it on the site) or on the staff member's own (they're the booker).",
    "The price is `totalPrice` if given, else the price list's. Without either, a customer's trip is booked on request; the staff member's own fails with `PRICE_REQUIRED`.",
    "Any future pickup time; a past one needs `backdated: true`. Both pins must be covered and not the same place, and the load must fit.",
    "Send an `Idempotency-Key`: repeating it returns the first booking (200). Needs `trips`.",
  ].join("\n\n"),
  middleware: staffWrite,
  security: staffSecurity,
  request: { headers: IdempotencyHeader, ...body(StaffBookTrip) },
  responses: {
    201: { description: "Booked", ...json(StaffBooking) },
    200: { description: "Already booked with this Idempotency-Key", ...json(StaffBooking) },
    400: invalid,
    ...staffProblems,
    422: problemResponse(
      "CUSTOMER_NOT_AVAILABLE, PRICE_REQUIRED (`leg`), PICKUP_TIME_INVALID (`reason`, `leg`), OUT_OF_COVERAGE, QUOTE_SAME_PLACE or LOAD_DOES_NOT_FIT.",
    ),
  },
});

const list = createRoute({
  method: "get",
  path: "/staff/trips",
  tags,
  summary: "List trips",
  description:
    "Newest pickup first. Filter by status, a pickup range (`from` inclusive, `to` exclusive), driver, vehicle, office or unassigned; `q` matches every word against the code, the passenger's name and phone. Needs `trips`.",
  middleware: staffRead,
  security: staffSecurity,
  request: { query: ListTrips },
  responses: {
    200: { description: "One page of trips", ...json(page(Trip)) },
    400: invalid,
    ...staffProblems,
  },
});

const get = createRoute({
  method: "get",
  path: "/staff/trips/{id}",
  tags,
  summary: "Get a trip",
  description: "With its history, its linked trips and the driver's report, if any. Needs `trips`.",
  middleware: staffRead,
  security: staffSecurity,
  request: { params: IdParam },
  responses: {
    200: { description: "The trip", ...json(TripDetail) },
    ...staffProblems,
    404: notFound,
  },
});

const update = createRoute({
  method: "patch",
  path: "/staff/trips/{id}",
  tags,
  summary: "Change a trip",
  description:
    "Send only what changes. The details change while the trip is pending or confirmed; the price and payment until it's completed. Nothing is repriced on its own. Every change is recorded with before and after. Needs `trips`.",
  middleware: staffWrite,
  security: staffSecurity,
  request: { params: IdParam, ...body(UpdateTrip) },
  responses: {
    200: { description: "The trip", ...json(Trip) },
    400: invalid,
    ...staffProblems,
    404: notFound,
    409: problemResponse(
      "TRIP_STATUS_CONFLICT (`tripStatus`), or PRICE_REQUEST_OPEN: propose a price instead.",
    ),
    422: problemResponse(
      "OUT_OF_COVERAGE, QUOTE_SAME_PLACE, LOAD_DOES_NOT_FIT, or VEHICLE_TOO_SMALL for the assigned vehicle.",
    ),
  },
});

const overviewRoute = createRoute({
  method: "get",
  path: "/staff/overview",
  tags,
  summary: "What needs attention",
  description:
    "Counts for the dashboard's front page: today's and tomorrow's trips (Cairo days), unassigned, in progress, awaiting a report, overdue and waiting for a price. Needs `trips`.",
  middleware: staffRead,
  security: staffSecurity,
  responses: {
    200: { description: "The counts", ...json(TripOverview) },
    ...staffProblems,
  },
});

const propose = createRoute({
  method: "post",
  path: "/staff/trips/{id}/price",
  tags,
  summary: "Propose a price",
  description:
    "For a pending trip booked on request; proposing again replaces the earlier proposal. The booker then accepts or declines it, except on a trip a staff member booked, which is accepted at once. `saveToPricing` also writes it to the price list and needs `pricing`. Needs `trips`.",
  middleware: staffWrite,
  security: staffSecurity,
  request: { params: IdParam, ...body(ProposePrice) },
  responses: {
    200: { description: "The trip", ...json(Trip) },
    400: invalid,
    ...staffProblems,
    404: notFound,
    409: problemResponse("PRICE_NOT_REQUESTED"),
  },
});

const action = (path: string, summary: string, description: string, conflicts = statusConflict) =>
  createRoute({
    method: "post",
    path: `/staff/trips/{id}/${path}`,
    tags,
    summary,
    description: `${description} Needs \`trips\`.`,
    middleware: staffWrite,
    security: staffSecurity,
    request: { params: IdParam },
    responses: {
      200: { description: "The trip", ...json(Trip) },
      ...staffProblems,
      404: notFound,
      409: conflicts,
    },
  });

const confirm = action(
  "confirm",
  "Confirm a trip",
  "Pending to confirmed: the booking is accepted. Needs a quoted price or an accepted proposal.",
  problemResponse("TRIP_STATUS_CONFLICT (`tripStatus`), or PRICE_NOT_ACCEPTED."),
);
const start = action(
  "start",
  "Start a trip",
  "Confirmed to in progress. Needs a driver and a vehicle, or an office.",
  problemResponse(
    "TRIP_STATUS_CONFLICT (`tripStatus`), ASSIGNMENT_REQUIRED, or ASSIGNEE_BUSY (`field`): the driver or vehicle is on a trip in progress.",
  ),
);
const end = action("end", "End a trip", "In progress to awaiting the driver's report.");
const complete = action(
  "complete",
  "Complete a trip",
  "Awaiting report to completed, once staff have reviewed the report. A trip with a driver needs its report (an office trip doesn't). Writes the driver's ledger entries: an external driver's fee, the expenses they paid (not office fees), less the cash they collected.",
  problemResponse("TRIP_STATUS_CONFLICT (`tripStatus`), or REPORT_REQUIRED."),
);
const unstart = action(
  "unstart",
  "Undo a start",
  "In progress back to confirmed, for a trip started by mistake.",
);
const reopen = action(
  "reopen",
  "Reopen a completed trip",
  "Completed back to awaiting report, until its month's report is generated. Whatever completing wrote to the driver's ledger is reversed with an adjustment.",
  problemResponse("TRIP_STATUS_CONFLICT (`tripStatus`), or MONTH_REPORT_GENERATED."),
);

const cancel = createRoute({
  method: "post",
  path: "/staff/trips/{id}/cancel",
  tags,
  summary: "Cancel a trip",
  description:
    "Pending, confirmed or in progress, with a reason (OTHER needs a note). Only this trip: its linked trip stays. Needs `trips`.",
  middleware: staffWrite,
  security: staffSecurity,
  request: { params: IdParam, ...body(CancelTrip) },
  responses: {
    200: { description: "The trip", ...json(Trip) },
    400: invalid,
    ...staffProblems,
    404: notFound,
    409: statusConflict,
  },
});

const assign = createRoute({
  method: "put",
  path: "/staff/trips/{id}/assignment",
  tags,
  summary: "Assign a driver, a vehicle or an office",
  description:
    "The whole assignment, while the trip is pending or confirmed: what's left out is cleared. The vehicle must be the trip's body or larger. With an office, the driver and vehicle are optional and must come through it. A driver or vehicle with another live trip within 3 hours fails with `ASSIGNMENT_CONFLICT` listing them, unless `acknowledgeConflicts`. Needs `trips`.",
  middleware: staffWrite,
  security: staffSecurity,
  request: { params: IdParam, ...body(AssignTrip) },
  responses: {
    200: { description: "The trip", ...json(Trip) },
    400: invalid,
    ...staffProblems,
    404: notFound,
    409: problemResponse(
      "TRIP_STATUS_CONFLICT (`tripStatus`), or ASSIGNMENT_CONFLICT (`conflicts`).",
    ),
    422: problemResponse(
      "DRIVER_NOT_AVAILABLE, VEHICLE_NOT_AVAILABLE, OFFICE_NOT_AVAILABLE, VEHICLE_TOO_SMALL or ASSIGNMENT_OFFICE_MISMATCH.",
    ),
  },
});

const candidates = createRoute({
  method: "get",
  path: "/staff/trips/{id}/assignment/candidates",
  tags,
  summary: "Who could be assigned",
  description:
    "Live drivers, and live vehicles big enough for the trip, each with its live trips within 3 hours of the pickup. Needs `trips`.",
  middleware: staffRead,
  security: staffSecurity,
  request: { params: IdParam },
  responses: {
    200: { description: "The candidates", ...json(AssignmentCandidates) },
    ...staffProblems,
    404: notFound,
  },
});

const link = createRoute({
  method: "post",
  path: "/staff/trips/{id}/link",
  tags,
  summary: "Link a return trip",
  description:
    "Makes `returnTripId` this trip's return. Neither may be linked already, and the return must pick up later. Needs `trips`.",
  middleware: staffWrite,
  security: staffSecurity,
  request: { params: IdParam, ...body(LinkTrips) },
  responses: {
    200: { description: "The trip", ...json(Trip) },
    400: invalid,
    ...staffProblems,
    404: notFound,
    409: problemResponse("TRIP_ALREADY_LINKED"),
    422: problemResponse("TRIP_LINK_INVALID"),
  },
});

const unlink = createRoute({
  method: "delete",
  path: "/staff/trips/{id}/link",
  tags,
  summary: "Unlink a trip",
  description: "Removes the link between this trip and its outbound or return. Needs `trips`.",
  middleware: staffWrite,
  security: staffSecurity,
  request: { params: IdParam },
  responses: {
    200: { description: "The trip", ...json(Trip) },
    ...staffProblems,
    404: notFound,
    409: problemResponse("TRIP_NOT_LINKED"),
  },
});

const id = (c: { req: { valid: (target: "param") => { id: string } } }) => c.req.valid("param").id;

export const staffTripRoutes = createRouter()
  .openapi(book, async (c) => {
    const { trip, returnTrip, replayed } = await bookByStaff(
      c.req.valid("json"),
      staffId(c),
      c.req.valid("header")["idempotency-key"],
    );
    const booking = { trip: toTrip(trip), returnTrip: returnTrip && toTrip(returnTrip) };
    return replayed ? c.json(booking, 200) : c.json(booking, 201);
  })
  .openapi(list, async (c) => c.json(await listTrips(c.req.valid("query")), 200))
  .openapi(overviewRoute, async (c) => c.json(await overview(), 200))
  .openapi(get, async (c) => c.json(await getTrip(id(c)), 200))
  .openapi(update, async (c) =>
    c.json(await updateTrip(id(c), staffId(c), c.req.valid("json")), 200),
  )
  .openapi(propose, async (c) => {
    const input = c.req.valid("json");
    if (input.saveToPricing && !currentStaff(c).permissions.includes("pricing")) {
      throw new AppError({
        code: "FORBIDDEN",
        status: 403,
        detail: "Saving a price to the price list needs the pricing permission.",
      });
    }
    return c.json(await proposePrice(id(c), staffActor(c), input), 200);
  })
  .openapi(confirm, async (c) => c.json(await confirmTrip(id(c), staffId(c)), 200))
  .openapi(start, async (c) => c.json(await startTrip(id(c), { staffId: staffId(c) }), 200))
  .openapi(end, async (c) => c.json(await endTrip(id(c), { staffId: staffId(c) }), 200))
  .openapi(complete, async (c) => c.json(await completeTrip(id(c), staffId(c)), 200))
  .openapi(cancel, async (c) =>
    c.json(await cancelTrip(id(c), staffId(c), c.req.valid("json")), 200),
  )
  .openapi(unstart, async (c) => c.json(await unstartTrip(id(c), staffId(c)), 200))
  .openapi(reopen, async (c) => c.json(await reopenTrip(id(c), staffId(c)), 200))
  .openapi(assign, async (c) =>
    c.json(await assignTrip(id(c), staffId(c), c.req.valid("json")), 200),
  )
  .openapi(candidates, async (c) => c.json(await assignmentCandidates(id(c)), 200))
  .openapi(link, async (c) =>
    c.json(await linkTrips(id(c), c.req.valid("json").returnTripId, staffId(c)), 200),
  )
  .openapi(unlink, async (c) => c.json(await unlinkTrip(id(c), staffId(c)), 200));
