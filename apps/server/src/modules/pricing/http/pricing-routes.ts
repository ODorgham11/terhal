import { createRoute } from "@hono/zod-openapi";
import {
  BulkPricing,
  BulkPricingResult,
  CreatePricing,
  ListPricing,
  PricingCreated,
  PricingRow,
  UpdatePricing,
  page,
} from "@terhal/contracts";
import type { TypedResponse } from "hono";
import { z } from "zod";
import {
  requireAnyPermission,
  requirePermission,
  requireStaff,
} from "../../../platform/http/authenticate";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
import {
  bulkPricing,
  createPricing,
  deletePricing,
  exportPricing,
  listPricing,
  updatePricing,
} from "../application/pricing";
import { IdParam, perStaff, security, signedIn, staffActor } from "./shared";

const tags = ["Pricing"];
const notFound = problemResponse("NOT_FOUND: no price with this id.");

// Reads are shared with `trips` (X6); writes and the export need `pricing`.
const read = [requireStaff, requireAnyPermission("pricing", "trips")];
const write = [requireStaff, requirePermission("pricing"), perStaff("staff:pricing:write")];

// Registered before the routes with an {id}.
const exportCsv = createRoute({
  method: "get",
  path: "/staff/pricing/export.csv",
  tags,
  summary: "Download the price list as CSV",
  description:
    "Every row with both ends' and the class's names. The id, car and price columns are what the bulk upload takes. Needs `pricing`.",
  middleware: [requireStaff, requirePermission("pricing"), perStaff("staff:pricing:export", 10)],
  security,
  responses: {
    200: {
      description: "The price list",
      content: { "text/csv": { schema: z.string() } },
    },
    ...signedIn,
    429: problemResponse("RATE_LIMITED"),
  },
});

const list = createRoute({
  method: "get",
  path: "/staff/pricing",
  tags,
  summary: "List prices",
  description:
    "By route, then class and car body. `q` matches either end's names. Pass `nextCursor` back as `cursor` for the next page. Needs `pricing` or `trips`.",
  middleware: read,
  security,
  request: { query: ListPricing },
  responses: {
    200: { description: "One page of prices", ...json(page(PricingRow)) },
    400: problemResponse("VALIDATION_FAILED"),
    ...signedIn,
  },
});

const create = createRoute({
  method: "post",
  path: "/staff/pricing",
  tags,
  summary: "Add a price",
  description:
    "One direction of a route, or both with `bothWays`. The ends must be live places and the class active; an area can't be priced to itself. Needs `pricing`.",
  middleware: write,
  security,
  request: body(CreatePricing),
  responses: {
    201: { description: "Added", ...json(PricingCreated) },
    400: problemResponse("VALIDATION_FAILED, including unknown or deleted places and classes"),
    ...signedIn,
    409: problemResponse("PRICING_EXISTS: the route already has a price for this class and body."),
    429: problemResponse("RATE_LIMITED"),
  },
});

const bulk = createRoute({
  method: "put",
  path: "/staff/pricing",
  tags,
  summary: "Add or update many prices",
  description:
    "Up to 500 rows, all or nothing: a row whose route, class and body already have a price updates it, the rest are added. Every problem is listed as `rows.<index>.<field>`. Needs `pricing`.",
  middleware: [requireStaff, requirePermission("pricing"), perStaff("staff:pricing:bulk", 10)],
  security,
  request: body(BulkPricing),
  responses: {
    200: { description: "Saved", ...json(BulkPricingResult) },
    400: problemResponse("VALIDATION_FAILED"),
    ...signedIn,
    409: problemResponse(
      "PRICING_EXISTS: another change added one of these rows meanwhile; send it again.",
    ),
    429: problemResponse("RATE_LIMITED"),
  },
});

const update = createRoute({
  method: "patch",
  path: "/staff/pricing/{id}",
  tags,
  summary: "Change a price",
  description:
    "Only the price changes; a different route, class or body is another row. Needs `pricing`.",
  middleware: write,
  security,
  request: { params: IdParam, ...body(UpdatePricing) },
  responses: {
    200: { description: "Changed", ...json(PricingRow) },
    400: problemResponse("VALIDATION_FAILED"),
    ...signedIn,
    404: notFound,
    429: problemResponse("RATE_LIMITED"),
  },
});

const remove = createRoute({
  method: "delete",
  path: "/staff/pricing/{id}",
  tags,
  summary: "Remove a price",
  description: "The route is then priced by a broader row, or on request. Needs `pricing`.",
  middleware: write,
  security,
  request: { params: IdParam },
  responses: {
    204: { description: "Removed" },
    ...signedIn,
    404: notFound,
    429: problemResponse("RATE_LIMITED"),
  },
});

export const pricingRoutes = createRouter()
  .openapi(
    exportCsv,
    async (c) =>
      c.body(await exportPricing(), 200, {
        "Content-Type": "text/csv; charset=UTF-8",
        "Content-Disposition": 'attachment; filename="pricing.csv"',
        "Cache-Control": "no-store",
      }) as unknown as Response & TypedResponse<string, 200, "text">,
  )
  .openapi(list, async (c) => c.json(await listPricing(c.req.valid("query")), 200))
  .openapi(create, async (c) =>
    c.json(await createPricing(c.req.valid("json"), staffActor(c)), 201),
  )
  .openapi(bulk, async (c) => c.json(await bulkPricing(c.req.valid("json"), staffActor(c)), 200))
  .openapi(update, async (c) =>
    c.json(
      await updatePricing(c.req.valid("param").id, c.req.valid("json").price, staffActor(c)),
      200,
    ),
  )
  .openapi(remove, async (c) => {
    await deletePricing(c.req.valid("param").id, staffActor(c));
    return c.body(null, 204);
  });
