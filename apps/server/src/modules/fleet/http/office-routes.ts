import { createRoute } from "@hono/zod-openapi";
import {
  CreateOffice,
  IdParam,
  ListOffices,
  NearbyOffices,
  NearbyOfficesQuery,
  Office,
  OfficeDetail,
  UpdateOffice,
  page,
} from "@terhal/contracts";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
import { nearbyOffices } from "../application/nearby-offices";
import {
  archiveOffice,
  createOffice,
  getOffice,
  listOffices,
  restoreOffice,
  updateOffice,
} from "../application/offices";
import { actorOf, canRead, canWrite, security, staffProblems } from "./shared";

const tags = ["Offices"];
const notFound = problemResponse("NOT_FOUND: there's no such office.");
const invalid = problemResponse("VALIDATION_FAILED");

const list = createRoute({
  method: "get",
  path: "/staff/offices",
  tags,
  summary: "List offices",
  description:
    "Live offices by default, by name. `q` matches every word against the name, contact, phone and email. Pass `nextCursor` back as `cursor` for the next page.",
  middleware: canRead,
  security,
  request: { query: ListOffices },
  responses: {
    200: { description: "One page of offices", ...json(page(Office)) },
    400: invalid,
    ...staffProblems,
  },
});

const nearby = createRoute({
  method: "get",
  path: "/staff/offices/nearby",
  tags,
  summary: "Find offices near a pickup",
  description:
    "Resolves the pin to the most specific covered location, then lists the live offices placed in it, in one of the places it's part of, or in one of the places inside it, nearest first. Not paged.",
  middleware: canRead,
  security,
  request: { query: NearbyOfficesQuery },
  responses: {
    200: { description: "The pin's location and the offices near it", ...json(NearbyOffices) },
    400: invalid,
    ...staffProblems,
  },
});

const create = createRoute({
  method: "post",
  path: "/staff/offices",
  tags,
  summary: "Add an office",
  middleware: canWrite,
  security,
  request: body(CreateOffice),
  responses: {
    201: { description: "Added", ...json(Office) },
    400: invalid,
    ...staffProblems,
    409: problemResponse("OFFICE_NAME_TAKEN"),
    422: problemResponse("LOCATION_NOT_AVAILABLE: the location doesn't exist or is deleted."),
  },
});

const get = createRoute({
  method: "get",
  path: "/staff/offices/{id}",
  tags,
  summary: "Get an office",
  description:
    "With its live drivers and vehicles, and the trips handed to it that are still live.",
  middleware: canRead,
  security,
  request: { params: IdParam },
  responses: {
    200: { description: "The office", ...json(OfficeDetail) },
    ...staffProblems,
    404: notFound,
  },
});

const update = createRoute({
  method: "patch",
  path: "/staff/offices/{id}",
  tags,
  summary: "Change an office",
  description: "Only the fields sent change; null clears an optional one.",
  middleware: canWrite,
  security,
  request: { params: IdParam, ...body(UpdateOffice) },
  responses: {
    200: { description: "Changed", ...json(Office) },
    400: invalid,
    ...staffProblems,
    404: notFound,
    409: problemResponse("OFFICE_NAME_TAKEN"),
    422: problemResponse("LOCATION_NOT_AVAILABLE: the location doesn't exist or is deleted."),
  },
});

const archive = createRoute({
  method: "post",
  path: "/staff/offices/{id}/archive",
  tags,
  summary: "Archive an office",
  description:
    "Trips can't be handed to an archived office, and its drivers and vehicles stay linked to it. Refused while trips handed to it are pending, confirmed or in progress.",
  middleware: canWrite,
  security,
  request: { params: IdParam },
  responses: {
    200: { description: "Archived", ...json(Office) },
    ...staffProblems,
    404: notFound,
    409: problemResponse("HAS_UPCOMING_TRIPS: `trips` lists them."),
  },
});

const restore = createRoute({
  method: "post",
  path: "/staff/offices/{id}/restore",
  tags,
  summary: "Restore an archived office",
  middleware: canWrite,
  security,
  request: { params: IdParam },
  responses: {
    200: { description: "Restored", ...json(Office) },
    ...staffProblems,
    404: notFound,
  },
});

// nearby before {id}, so "nearby" is never read as an id.
export const officeRoutes = createRouter()
  .openapi(list, async (c) => c.json(await listOffices(c.req.valid("query")), 200))
  .openapi(nearby, async (c) => c.json(await nearbyOffices(c.req.valid("query")), 200))
  .openapi(create, async (c) => c.json(await createOffice(c.req.valid("json"), actorOf(c)), 201))
  .openapi(get, async (c) => c.json(await getOffice(c.req.valid("param").id), 200))
  .openapi(update, async (c) =>
    c.json(await updateOffice(c.req.valid("param").id, c.req.valid("json"), actorOf(c)), 200),
  )
  .openapi(archive, async (c) =>
    c.json(await archiveOffice(c.req.valid("param").id, actorOf(c)), 200),
  )
  .openapi(restore, async (c) =>
    c.json(await restoreOffice(c.req.valid("param").id, actorOf(c)), 200),
  );
