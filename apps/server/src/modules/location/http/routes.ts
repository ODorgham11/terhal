import { createRoute } from "@hono/zod-openapi";
import {
  Coverage,
  CoverageQuery,
  CreateLocation,
  DeleteLocation,
  ListLocations,
  Location,
  LocationDeleted,
  LocationDetail,
  LocationRestored,
  SiteLocationOutlines,
  SiteLocationOutlinesQuery,
  SiteLocations,
  UpdateLocation,
  page,
} from "@terhal/contracts";
import { z } from "zod";
import type { Context, MiddlewareHandler, TypedResponse } from "hono";
import type { AuditActor } from "../../audit/index";
import {
  ADMIN_COOKIE_AUTH,
  STAFF_COOKIE_AUTH,
  currentAdminId,
  currentStaff,
  requireAdmin,
  requirePermission,
  requireStaff,
} from "../../../platform/http/authenticate";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
import {
  createRateLimitKey,
  getClientIp,
  ipKey,
  rateLimit,
} from "../../../platform/rate-limit/rate-limit";
import { coverage } from "../application/coverage";
import {
  createLocation,
  deleteLocation,
  getLocation,
  listLocations,
  restoreLocation,
  updateLocation,
} from "../application/locations";
import { siteTree } from "../application/site-tree";

const MINUTE = 60 * 1000;
const tags = ["Locations"];
const IdParam = z.object({ id: z.string().min(1, "Id is required.") });

const ipAddress = (c: Context) => {
  const ip = getClientIp(c);
  return ip === "unknown" ? null : ip;
};

const signedIn = {
  401: problemResponse("UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in."),
  403: problemResponse("ACCOUNT_NOT_ACTIVE, or FORBIDDEN without the permission."),
};
const notFound = problemResponse("NOT_FOUND: no location with this id.");

interface Audience<P extends string> {
  prefix: P;
  security: Record<string, string[]>[];
  // Reading and writing guards, in order (sign in, then the permission).
  read: MiddlewareHandler[];
  write: MiddlewareHandler[];
  actor: (c: Context) => AuditActor;
  permissions: { read: string; write: string };
}

// The admin panel and the dashboard manage locations the same way (X5, answered: full CRUD on both); only the guards and
// who the audit log names differ.
const managementRoutes = <P extends "admin" | "staff">(audience: Audience<P>) => {
  const base = `/${audience.prefix}/locations` as const;
  const { security } = audience;
  const reading = audience.permissions.read && ` ${audience.permissions.read}`;
  const writing = audience.permissions.write && ` ${audience.permissions.write}`;

  // Registered before /{id}, which would otherwise match "coverage".
  const coverageRoute = createRoute({
    method: "get",
    path: `${base}/coverage`,
    tags,
    summary: "Find the location covering a point",
    description: `The most specific live location: an area before a district before a governorate, then the nearest center.${reading}`,
    middleware: audience.read,
    security,
    request: { query: CoverageQuery },
    responses: {
      200: { description: "Covered or not", ...json(Coverage) },
      400: problemResponse("VALIDATION_FAILED"),
      ...signedIn,
    },
  });

  const list = createRoute({
    method: "get",
    path: base,
    tags,
    summary: "List locations",
    description: `Live locations by English name, or only deleted ones with \`deleted=true\`. \`q\` matches either name, ignoring Arabic letter forms and diacritics. Pass \`nextCursor\` back as \`cursor\` for the next page.${reading}`,
    middleware: audience.read,
    security,
    request: { query: ListLocations },
    responses: {
      200: { description: "One page of locations", ...json(page(Location)) },
      400: problemResponse("VALIDATION_FAILED"),
      ...signedIn,
    },
  });

  const detail = createRoute({
    method: "get",
    path: `${base}/{id}`,
    tags,
    summary: "Get a location",
    description: `With its outline, ancestors, the size of its live subtree and what uses it.${reading}`,
    middleware: audience.read,
    security,
    request: { params: IdParam },
    responses: {
      200: { description: "The location", ...json(LocationDetail) },
      ...signedIn,
      404: notFound,
    },
  });

  const create = createRoute({
    method: "post",
    path: base,
    tags,
    summary: "Create a district or an area",
    description: `Governorates come from the seed. A district goes in a governorate; an area in a district or directly in a governorate.${writing}`,
    middleware: audience.write,
    security,
    request: body(CreateLocation),
    responses: {
      201: { description: "Created", ...json(Location) },
      400: problemResponse("VALIDATION_FAILED"),
      ...signedIn,
      409: problemResponse(
        "LOCATION_PARENT_INVALID (missing, deleted or not broader) or LOCATION_NAME_TAKEN (a live sibling has the name)",
      ),
      429: problemResponse("RATE_LIMITED"),
    },
  });

  const update = createRoute({
    method: "patch",
    path: `${base}/{id}`,
    tags,
    summary: "Rename, move or reshape a location",
    description: `Send only what changes. A governorate can only be renamed.${writing}`,
    middleware: audience.write,
    security,
    request: { params: IdParam, ...body(UpdateLocation) },
    responses: {
      200: { description: "Updated", ...json(Location) },
      400: problemResponse("VALIDATION_FAILED"),
      ...signedIn,
      404: notFound,
      409: problemResponse(
        "LOCATION_DELETED, GOVERNORATE_READ_ONLY, LOCATION_PARENT_INVALID or LOCATION_NAME_TAKEN",
      ),
      429: problemResponse("RATE_LIMITED"),
    },
  });

  const remove = createRoute({
    method: "delete",
    path: `${base}/{id}`,
    tags,
    summary: "Delete a location and everything in it",
    description: `Soft: the location and its live descendants are marked deleted together, and restoring it brings exactly those back. Prices and trips keep pointing at them; deleted places stop matching coverage and quotes. \`expectedCount\` must be the live subtree's size (\`subtreeSize\` on the detail).${writing}`,
    middleware: audience.write,
    security,
    request: { params: IdParam, query: DeleteLocation },
    responses: {
      200: { description: "Deleted", ...json(LocationDeleted) },
      400: problemResponse("VALIDATION_FAILED"),
      ...signedIn,
      404: notFound,
      409: problemResponse(
        "LOCATION_COUNT_MISMATCH (with the current `count`), LOCATION_DELETED or GOVERNORATE_READ_ONLY",
      ),
      429: problemResponse("RATE_LIMITED"),
    },
  });

  const restore = createRoute({
    method: "post",
    path: `${base}/{id}/restore`,
    tags,
    summary: "Restore a deleted location",
    description: `Brings back everything its delete removed. Only the location a delete started from can be restored, while its parent is live and its name is free.${writing}`,
    middleware: audience.write,
    security,
    request: { params: IdParam },
    responses: {
      200: { description: "Restored", ...json(LocationRestored) },
      ...signedIn,
      404: notFound,
      409: problemResponse("LOCATION_NOT_RESTORABLE or LOCATION_NAME_TAKEN"),
      429: problemResponse("RATE_LIMITED"),
    },
  });

  return createRouter()
    .openapi(coverageRoute, async (c) => c.json(await coverage(c.req.valid("query")), 200))
    .openapi(list, async (c) => c.json(await listLocations(c.req.valid("query")), 200))
    .openapi(detail, async (c) => c.json(await getLocation(c.req.valid("param").id), 200))
    .openapi(create, async (c) =>
      c.json(await createLocation(c.req.valid("json"), audience.actor(c)), 201),
    )
    .openapi(update, async (c) =>
      c.json(
        await updateLocation(c.req.valid("param").id, c.req.valid("json"), audience.actor(c)),
        200,
      ),
    )
    .openapi(remove, async (c) =>
      c.json(
        await deleteLocation(
          c.req.valid("param").id,
          c.req.valid("query").expectedCount,
          audience.actor(c),
        ),
        200,
      ),
    )
    .openapi(restore, async (c) =>
      c.json(await restoreLocation(c.req.valid("param").id, audience.actor(c)), 200),
    );
};

const writeLimit = (scope: string, user: (c: Context) => string) =>
  rateLimit({
    limit: 60,
    windowMs: MINUTE,
    key: (c) => createRateLimitKey(scope, "user", user(c)),
  });

export const adminLocationRoutes = managementRoutes({
  prefix: "admin",
  security: [{ [ADMIN_COOKIE_AUTH]: [] }],
  read: [requireAdmin],
  write: [requireAdmin, writeLimit("admin:locations:write", currentAdminId)],
  actor: (c) => ({ adminId: currentAdminId(c), ipAddress: ipAddress(c) }),
  permissions: { read: "", write: "" },
});

// Any staff member reads locations (booking needs them); changing them takes `pricing`.
export const staffLocationRoutes = managementRoutes({
  prefix: "staff",
  security: [{ [STAFF_COOKIE_AUTH]: [] }],
  read: [requireStaff],
  write: [
    requireStaff,
    requirePermission("pricing"),
    writeLimit("staff:locations:write", (c) => currentStaff(c).staffId),
  ],
  actor: (c) => ({ staffId: currentStaff(c).staffId, ipAddress: ipAddress(c) }),
  permissions: { read: "Any staff member.", write: "Needs `pricing`." },
});

// The tree is cached by browsers and proxies for a minute and revalidated with its ETag after that (the L8
// assessment); the outlines URL carries their version, so it's cached for good.
const TREE_CACHE = "public, max-age=60, stale-while-revalidate=600";
const IMMUTABLE = "public, max-age=31536000, immutable";

const matches = (ifNoneMatch: string | undefined, etag: string) =>
  ifNoneMatch
    ?.split(",")
    .map((value) => value.trim().replace(/^W\//, ""))
    .some((value) => value === etag || value === "*") ?? false;

const tree = createRoute({
  method: "get",
  path: "/site/locations",
  tags,
  summary: "The live location tree",
  description:
    "Every live location with its names, center and radius, for the map and for searching in the browser. Revalidate with `If-None-Match`; outlines come separately from /v1/site/locations/outlines.",
  request: {
    headers: z.object({ "if-none-match": z.string().optional() }),
  },
  responses: {
    200: { description: "The tree", ...json(SiteLocations) },
    304: { description: "Unchanged since the ETag sent" },
  },
});

const outlines = createRoute({
  method: "get",
  path: "/site/locations/outlines",
  tags,
  summary: "Governorate outlines",
  description:
    "GeoJSON outlines of the live governorates. Pass the tree's `outlinesVersion` as `v`: that URL is cached for good. Any other `v` gets the current outlines, cached for a minute.",
  request: { query: SiteLocationOutlinesQuery },
  responses: {
    200: { description: "The outlines", ...json(SiteLocationOutlines) },
    400: problemResponse("VALIDATION_FAILED"),
  },
});

const siteCoverage = createRoute({
  method: "get",
  path: "/site/locations/coverage",
  tags,
  summary: "Is this point served?",
  description: "The most specific live location covering the point, or `covered: false`.",
  middleware: [
    rateLimit({ limit: 120, windowMs: MINUTE, key: ipKey("site:locations:coverage") }),
  ] as const,
  request: { query: CoverageQuery },
  responses: {
    200: { description: "Covered or not", ...json(Coverage) },
    400: problemResponse("VALIDATION_FAILED"),
    429: problemResponse("RATE_LIMITED"),
  },
});

const jsonHeaders = { "Content-Type": "application/json; charset=UTF-8" };

export const siteLocationRoutes = createRouter()
  .openapi(outlines, async (c) => {
    const built = await siteTree();
    const current = c.req.valid("query").v === built.outlinesVersion;
    // Already serialized: typed as the contract it was built from.
    return c.body(built.outlines, 200, {
      ...jsonHeaders,
      "Cache-Control": current ? IMMUTABLE : "public, max-age=60",
    }) as unknown as Response & TypedResponse<SiteLocationOutlines, 200, "json">;
  })
  .openapi(siteCoverage, async (c) => c.json(await coverage(c.req.valid("query")), 200))
  .openapi(tree, async (c) => {
    const built = await siteTree();
    const etag = `"${built.version}"`;
    const headers = { ETag: etag, "Cache-Control": TREE_CACHE };
    if (matches(c.req.valid("header")["if-none-match"], etag)) return c.body(null, 304, headers);
    return c.body(built.tree, 200, { ...jsonHeaders, ...headers });
  });
