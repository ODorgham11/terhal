import { createRoute } from "@hono/zod-openapi";
import {
  CreateTripClass,
  ListTripClasses,
  SiteTripClass,
  StaffTripClass,
  TripClass,
  UpdateTripClass,
  page,
} from "@terhal/contracts";
import { z } from "zod";
import {
  requireAnyPermission,
  requirePermission,
  requireStaff,
} from "../../../platform/http/authenticate";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
import {
  archiveTripClass,
  createTripClass,
  listSiteTripClasses,
  listTripClasses,
  restoreTripClass,
  updateTripClass,
} from "../application/trip-classes";
import { IdParam, perStaff, security, signedIn, staffActor } from "./shared";

const tags = ["Trip classes"];
const notFound = problemResponse("NOT_FOUND: no trip class with this id.");
const nameTaken = problemResponse("TRIP_CLASS_NAME_TAKEN: an active class has the name.");

// Reads are shared with `trips` (X6): booking needs the classes.
const read = [requireStaff, requireAnyPermission("pricing", "trips")];
const write = [requireStaff, requirePermission("pricing"), perStaff("staff:trip-classes:write")];

const list = createRoute({
  method: "get",
  path: "/staff/trip-classes",
  tags,
  summary: "List trip classes",
  description:
    "Active classes in the site's order, or only archived ones with `archived=true`, each with its price rows and this month's trips. Needs `pricing` or `trips`.",
  middleware: read,
  security,
  request: { query: ListTripClasses },
  responses: {
    200: { description: "The classes", ...json(page(StaffTripClass)) },
    400: problemResponse("VALIDATION_FAILED"),
    ...signedIn,
  },
});

const create = createRoute({
  method: "post",
  path: "/staff/trip-classes",
  tags,
  summary: "Create a trip class",
  description: "Needs `pricing`.",
  middleware: write,
  security,
  request: body(CreateTripClass),
  responses: {
    201: { description: "Created", ...json(TripClass) },
    400: problemResponse("VALIDATION_FAILED"),
    ...signedIn,
    409: nameTaken,
    429: problemResponse("RATE_LIMITED"),
  },
});

const update = createRoute({
  method: "patch",
  path: "/staff/trip-classes/{id}",
  tags,
  summary: "Change a trip class",
  description:
    "Send only what changes; an empty description clears it. Past trips keep the name they were booked with. Needs `pricing`.",
  middleware: write,
  security,
  request: { params: IdParam, ...body(UpdateTripClass) },
  responses: {
    200: { description: "Updated", ...json(TripClass) },
    400: problemResponse("VALIDATION_FAILED"),
    ...signedIn,
    404: notFound,
    409: nameTaken,
    429: problemResponse("RATE_LIMITED"),
  },
});

const archive = createRoute({
  method: "post",
  path: "/staff/trip-classes/{id}/archive",
  tags,
  summary: "Archive a trip class",
  description:
    "It leaves quotes and booking; its prices stay and come back on restore. Existing trips are untouched. Needs `pricing`.",
  middleware: write,
  security,
  request: { params: IdParam },
  responses: {
    200: { description: "Archived", ...json(TripClass) },
    ...signedIn,
    404: notFound,
    429: problemResponse("RATE_LIMITED"),
  },
});

const restore = createRoute({
  method: "post",
  path: "/staff/trip-classes/{id}/restore",
  tags,
  summary: "Restore an archived trip class",
  description: "With its prices. Needs `pricing`.",
  middleware: write,
  security,
  request: { params: IdParam },
  responses: {
    200: { description: "Restored", ...json(TripClass) },
    ...signedIn,
    404: notFound,
    409: nameTaken,
    429: problemResponse("RATE_LIMITED"),
  },
});

const siteList = createRoute({
  method: "get",
  path: "/site/trip-classes",
  tags,
  summary: "The active trip classes",
  description: "In display order, with what each includes.",
  responses: {
    200: { description: "The classes", ...json(z.object({ data: z.array(SiteTripClass) })) },
  },
});

export const tripClassRoutes = createRouter()
  .openapi(list, async (c) => c.json(await listTripClasses(c.req.valid("query")), 200))
  .openapi(create, async (c) =>
    c.json(await createTripClass(c.req.valid("json"), staffActor(c)), 201),
  )
  .openapi(update, async (c) =>
    c.json(await updateTripClass(c.req.valid("param").id, c.req.valid("json"), staffActor(c)), 200),
  )
  .openapi(archive, async (c) =>
    c.json(await archiveTripClass(c.req.valid("param").id, staffActor(c)), 200),
  )
  .openapi(restore, async (c) =>
    c.json(await restoreTripClass(c.req.valid("param").id, staffActor(c)), 200),
  )
  .openapi(siteList, async (c) => c.json(await listSiteTripClasses(), 200));
