import { createRoute } from "@hono/zod-openapi";
import { Brand, CreateBrand, ListBrands, UpdateBrand, page } from "@terhal/contracts";
import {
  requireAnyPermission,
  requirePermission,
  requireStaff,
} from "../../../platform/http/authenticate";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
import {
  archiveBrand,
  createBrand,
  listBrands,
  restoreBrand,
  updateBrand,
} from "../application/brands";
import { IdParam, perStaff, security, signedIn, staffActor } from "./shared";

const tags = ["Brands"];
const notFound = problemResponse("NOT_FOUND: no brand with this id.");
const nameTaken = problemResponse("BRAND_NAME_TAKEN: an active brand has the name.");

// Booking needs the brands to pick from, so `trips` reads them too. Changing them is company setup, like the team.
const read = [requireStaff, requireAnyPermission("team", "trips")];
const write = [requireStaff, requirePermission("team"), perStaff("staff:brands:write")];

const list = createRoute({
  method: "get",
  path: "/staff/brands",
  tags,
  summary: "List brands",
  description:
    "The brands a trip can be sent under besides Terhal, which is built in. Active ones, or only archived ones with `archived=true`. Needs `team` or `trips`.",
  middleware: read,
  security,
  request: { query: ListBrands },
  responses: {
    200: { description: "The brands", ...json(page(Brand)) },
    400: problemResponse("VALIDATION_FAILED"),
    ...signedIn,
  },
});

const create = createRoute({
  method: "post",
  path: "/staff/brands",
  tags,
  summary: "Add a brand",
  description:
    "Its sender address must be on a domain verified with the email provider, or its emails fail. Needs `team`.",
  middleware: write,
  security,
  request: body(CreateBrand),
  responses: {
    201: { description: "Created", ...json(Brand) },
    400: problemResponse("VALIDATION_FAILED"),
    ...signedIn,
    409: nameTaken,
    429: problemResponse("RATE_LIMITED"),
  },
});

const update = createRoute({
  method: "patch",
  path: "/staff/brands/{id}",
  tags,
  summary: "Change a brand",
  description:
    "Send only what changes; empty text clears an optional field. Messages sent from now on use the new details. Needs `team`.",
  middleware: write,
  security,
  request: { params: IdParam, ...body(UpdateBrand) },
  responses: {
    200: { description: "Updated", ...json(Brand) },
    400: problemResponse("VALIDATION_FAILED"),
    ...signedIn,
    404: notFound,
    409: nameTaken,
    429: problemResponse("RATE_LIMITED"),
  },
});

const archive = createRoute({
  method: "post",
  path: "/staff/brands/{id}/archive",
  tags,
  summary: "Archive a brand",
  description:
    "It can't be picked for new trips and stops being the default. Trips under it keep it. Needs `team`.",
  middleware: write,
  security,
  request: { params: IdParam },
  responses: {
    200: { description: "Archived", ...json(Brand) },
    ...signedIn,
    404: notFound,
    429: problemResponse("RATE_LIMITED"),
  },
});

const restore = createRoute({
  method: "post",
  path: "/staff/brands/{id}/restore",
  tags,
  summary: "Restore an archived brand",
  description: "Needs `team`.",
  middleware: write,
  security,
  request: { params: IdParam },
  responses: {
    200: { description: "Restored", ...json(Brand) },
    ...signedIn,
    404: notFound,
    409: nameTaken,
    429: problemResponse("RATE_LIMITED"),
  },
});

export const brandRoutes = createRouter()
  .openapi(list, async (c) => c.json(await listBrands(c.req.valid("query")), 200))
  .openapi(create, async (c) => c.json(await createBrand(c.req.valid("json"), staffActor(c)), 201))
  .openapi(update, async (c) =>
    c.json(await updateBrand(c.req.valid("param").id, c.req.valid("json"), staffActor(c)), 200),
  )
  .openapi(archive, async (c) =>
    c.json(await archiveBrand(c.req.valid("param").id, staffActor(c)), 200),
  )
  .openapi(restore, async (c) =>
    c.json(await restoreBrand(c.req.valid("param").id, staffActor(c)), 200),
  );
