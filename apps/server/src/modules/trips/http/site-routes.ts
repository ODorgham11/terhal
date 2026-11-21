import { createRoute } from "@hono/zod-openapi";
import {
  AcceptPrice,
  BookTrip,
  DeclinePrice,
  IdempotencyHeader,
  ListSiteTrips,
  SiteBooking,
  SiteCancelTrip,
  SiteTrip,
  SiteTripsChanged,
  page,
} from "@terhal/contracts";
import { requireBooker } from "../../../platform/http/authenticate";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
import { ipKey, rateLimit } from "../../../platform/rate-limit/rate-limit";
import { bookOnline } from "../application/booking";
import { cancelOnline } from "../application/lifecycle";
import { acceptPrice, declinePrice } from "../application/price-requests";
import { getSiteTrip, listSiteTrips } from "../application/queries";
import { toSiteTrip } from "../application/shared";
import {
  HOUR,
  IdParam,
  booker,
  invalid,
  notFound,
  siteProblems,
  siteRead,
  siteSecurity,
  siteWrite,
  tags,
} from "./shared";

// The customer site: a signed in customer or a verified guest books, follows and cancels their trips, and answers a
// proposed price.

const book = createRoute({
  method: "post",
  path: "/site/trips",
  tags,
  summary: "Book a trip",
  description: [
    "For a customer or a verified guest. The pickup must be 3 hours to 90 days ahead, on a quarter hour (Cairo time); both pins must be covered and not the same place; the passengers and luggage must fit the body.",
    "`expectedPrice` is the quoted price: a different current price fails with `PRICE_CHANGED` carrying it (null when the route has no price any more). An option without a price is booked on request (`priceState` REQUESTED).",
    "With `return`, a second trip is booked in the same transaction, linked to the first. At most 3 pending trips per customer or guest email.",
    "Send an `Idempotency-Key`: repeating it returns the first booking (200) instead of booking again.",
  ].join("\n\n"),
  middleware: [
    rateLimit({ limit: 10, windowMs: HOUR, key: ipKey("site:trips:book") }),
    requireBooker,
  ] as const,
  security: siteSecurity,
  request: { headers: IdempotencyHeader, ...body(BookTrip) },
  responses: {
    201: { description: "Booked", ...json(SiteBooking) },
    200: { description: "Already booked with this Idempotency-Key", ...json(SiteBooking) },
    400: invalid,
    ...siteProblems,
    409: problemResponse(
      "PRICE_CHANGED (`price`, `leg`), or PENDING_TRIP_LIMIT: 3 trips are already waiting for confirmation.",
    ),
    422: problemResponse(
      "PICKUP_TIME_INVALID (`reason`, `leg`), OUT_OF_COVERAGE (`end`, `leg`), QUOTE_SAME_PLACE (`leg`) or LOAD_DOES_NOT_FIT.",
    ),
  },
});

const list = createRoute({
  method: "get",
  path: "/site/trips",
  tags,
  summary: "List my trips",
  description:
    "Newest pickup first. A customer sees the trips booked for them; a verified guest, every guest trip booked with the same verified email.",
  middleware: siteRead,
  security: siteSecurity,
  request: { query: ListSiteTrips },
  responses: {
    200: { description: "One page of trips", ...json(page(SiteTrip)) },
    400: invalid,
    ...siteProblems,
  },
});

const get = createRoute({
  method: "get",
  path: "/site/trips/{id}",
  tags,
  summary: "Get one of my trips",
  description: "With the driver and vehicle once the trip is confirmed and assigned.",
  middleware: siteRead,
  security: siteSecurity,
  request: { params: IdParam },
  responses: {
    200: { description: "The trip", ...json(SiteTrip) },
    ...siteProblems,
    404: notFound,
  },
});

const cancel = createRoute({
  method: "post",
  path: "/site/trips/{id}/cancel",
  tags,
  summary: "Cancel my booking",
  description:
    "Only pending trips can be cancelled online; a confirmed one fails with `CALL_TO_CANCEL`. The whole booking is cancelled (a trip and its return), except a leg that has already started.",
  middleware: siteWrite,
  security: siteSecurity,
  request: { params: IdParam, ...body(SiteCancelTrip) },
  responses: {
    200: { description: "The cancelled trips", ...json(SiteTripsChanged) },
    400: invalid,
    ...siteProblems,
    404: notFound,
    409: problemResponse("CALL_TO_CANCEL, or TRIP_STATUS_CONFLICT (`tripStatus`)."),
  },
});

const accept = createRoute({
  method: "post",
  path: "/site/trips/{id}/price/accept",
  tags,
  summary: "Accept a proposed price",
  description:
    "Accepts every proposed leg of the booking. `expectedPrice` is the total of the proposals shown; if a proposal changed, it fails with `PRICE_CHANGED` and the current total.",
  middleware: siteWrite,
  security: siteSecurity,
  request: { params: IdParam, ...body(AcceptPrice) },
  responses: {
    200: { description: "The accepted trips", ...json(SiteTripsChanged) },
    400: invalid,
    ...siteProblems,
    404: notFound,
    409: problemResponse("PRICE_NOT_PROPOSED, or PRICE_CHANGED (`price`, `legs`)."),
  },
});

const decline = createRoute({
  method: "post",
  path: "/site/trips/{id}/price/decline",
  tags,
  summary: "Decline a proposed price",
  description:
    "Cancels the trip. Declining the outbound also cancels its pending return; declining the return keeps the outbound.",
  middleware: siteWrite,
  security: siteSecurity,
  request: { params: IdParam, ...body(DeclinePrice) },
  responses: {
    200: { description: "The cancelled trips", ...json(SiteTripsChanged) },
    400: invalid,
    ...siteProblems,
    404: notFound,
    409: problemResponse("PRICE_NOT_PROPOSED"),
  },
});

export const siteTripRoutes = createRouter()
  .openapi(book, async (c) => {
    const { trip, returnTrip, replayed } = await bookOnline(
      c.req.valid("json"),
      booker(c),
      c.req.valid("header")["idempotency-key"],
    );
    const booking = { trip: toSiteTrip(trip), returnTrip: returnTrip && toSiteTrip(returnTrip) };
    return replayed ? c.json(booking, 200) : c.json(booking, 201);
  })
  .openapi(list, async (c) => c.json(await listSiteTrips(booker(c), c.req.valid("query")), 200))
  .openapi(get, async (c) => c.json(await getSiteTrip(booker(c), c.req.valid("param").id), 200))
  .openapi(cancel, async (c) =>
    c.json(await cancelOnline(booker(c), c.req.valid("param").id, c.req.valid("json").reason), 200),
  )
  .openapi(accept, async (c) =>
    c.json(
      await acceptPrice(booker(c), c.req.valid("param").id, c.req.valid("json").expectedPrice),
      200,
    ),
  )
  .openapi(decline, async (c) =>
    c.json(await declinePrice(booker(c), c.req.valid("param").id, c.req.valid("json").reason), 200),
  );
