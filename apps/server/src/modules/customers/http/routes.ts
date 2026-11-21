import { createRoute } from "@hono/zod-openapi";
import {
  CustomerDetail,
  CustomerSummary,
  CustomerTrip,
  IdParam,
  ListCustomerTrips,
  ListCustomers,
  page,
} from "@terhal/contracts";
import type { Context } from "hono";
import {
  ADMIN_COOKIE_AUTH,
  STAFF_COOKIE_AUTH,
  currentAdminId,
  currentStaff,
  requireAdmin,
  requireAnyPermission,
  requirePermission,
  requireStaff,
} from "../../../platform/http/authenticate";
import { createRouter, json, problemResponse } from "../../../platform/http/router";
import { createRateLimitKey, rateLimit } from "../../../platform/rate-limit/rate-limit";
import { getCustomer, listCustomerTrips, listCustomers } from "../application/views";

const MINUTE = 60 * 1000;

const perStaff = (scope: string) =>
  rateLimit({
    limit: 120,
    windowMs: MINUTE,
    key: (c: Context) => createRateLimitKey(scope, "user", currentStaff(c).staffId),
  });

const perAdmin = (scope: string) =>
  rateLimit({
    limit: 120,
    windowMs: MINUTE,
    key: (c: Context) => createRateLimitKey(scope, "user", currentAdminId(c)),
  });

const notFound = problemResponse("NOT_FOUND: no customer with this id.");
const invalid = problemResponse("VALIDATION_FAILED");
const rateLimited = problemResponse("RATE_LIMITED: see the Retry-After header.");
const unauthenticated = problemResponse(
  "UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in.",
);

// The dashboard. Staff only view customers: `customers`, or `trips` for the list, which booking for a customer needs.

const staffTags = ["Customers"];
const staffSecurity = [{ [STAFF_COOKIE_AUTH]: [] }];
const staffErrors = (permissions: string) => ({
  401: unauthenticated,
  403: problemResponse(`ACCOUNT_NOT_ACTIVE, or FORBIDDEN without ${permissions}.`),
  429: rateLimited,
});

const staffList = createRoute({
  method: "get",
  path: "/staff/customers",
  tags: staffTags,
  summary: "List customers",
  description: "Newest first, a page at a time. Guests aren't customers and never appear.",
  middleware: [
    requireStaff,
    requireAnyPermission("customers", "trips"),
    perStaff("staff:customers:list"),
  ],
  security: staffSecurity,
  request: { query: ListCustomers },
  responses: {
    200: { description: "The customers", ...json(page(CustomerSummary)) },
    400: invalid,
    ...staffErrors("the customers or trips permission"),
  },
});

const staffDetail = createRoute({
  method: "get",
  path: "/staff/customers/{id}",
  tags: staffTags,
  summary: "A customer",
  description: "With how many trips they booked and the total of their completed trips.",
  middleware: [requireStaff, requirePermission("customers"), perStaff("staff:customers:detail")],
  security: staffSecurity,
  request: { params: IdParam },
  responses: {
    200: { description: "The customer", ...json(CustomerDetail) },
    ...staffErrors("the customers permission"),
    404: notFound,
  },
});

const staffTrips = createRoute({
  method: "get",
  path: "/staff/customers/{id}/trips",
  tags: staffTags,
  summary: "A customer's trips",
  description: "Latest pickup first, a page at a time.",
  middleware: [requireStaff, requirePermission("customers"), perStaff("staff:customers:trips")],
  security: staffSecurity,
  request: { params: IdParam, query: ListCustomerTrips },
  responses: {
    200: { description: "Their trips", ...json(page(CustomerTrip)) },
    400: invalid,
    ...staffErrors("the customers permission"),
    404: notFound,
  },
});

export const staffCustomerRoutes = createRouter()
  .openapi(staffList, async (c) => {
    return c.json(await listCustomers(c.req.valid("query")), 200);
  })
  .openapi(staffDetail, async (c) => {
    return c.json(await getCustomer(c.req.valid("param").id), 200);
  })
  .openapi(staffTrips, async (c) => {
    return c.json(await listCustomerTrips(c.req.valid("param").id, c.req.valid("query")), 200);
  });

// The admin panel: the same views. Suspending and reactivating are in the identity module.

const adminTags = ["Admin customers"];
const adminSecurity = [{ [ADMIN_COOKIE_AUTH]: [] }];
const adminErrors = {
  401: unauthenticated,
  403: problemResponse("ACCOUNT_NOT_ACTIVE"),
  429: rateLimited,
};

const adminList = createRoute({
  method: "get",
  path: "/admin/customers",
  tags: adminTags,
  summary: "List customers",
  description: "Newest first, a page at a time. Guests aren't customers and never appear.",
  middleware: [requireAdmin, perAdmin("admin:customers:list")],
  security: adminSecurity,
  request: { query: ListCustomers },
  responses: {
    200: { description: "The customers", ...json(page(CustomerSummary)) },
    400: invalid,
    ...adminErrors,
  },
});

const adminDetail = createRoute({
  method: "get",
  path: "/admin/customers/{id}",
  tags: adminTags,
  summary: "A customer",
  description: "With how many trips they booked and the total of their completed trips.",
  middleware: [requireAdmin, perAdmin("admin:customers:detail")],
  security: adminSecurity,
  request: { params: IdParam },
  responses: {
    200: { description: "The customer", ...json(CustomerDetail) },
    ...adminErrors,
    404: notFound,
  },
});

const adminTrips = createRoute({
  method: "get",
  path: "/admin/customers/{id}/trips",
  tags: adminTags,
  summary: "A customer's trips",
  description: "Latest pickup first, a page at a time.",
  middleware: [requireAdmin, perAdmin("admin:customers:trips")],
  security: adminSecurity,
  request: { params: IdParam, query: ListCustomerTrips },
  responses: {
    200: { description: "Their trips", ...json(page(CustomerTrip)) },
    400: invalid,
    ...adminErrors,
    404: notFound,
  },
});

export const adminCustomerRoutes = createRouter()
  .openapi(adminList, async (c) => {
    return c.json(await listCustomers(c.req.valid("query")), 200);
  })
  .openapi(adminDetail, async (c) => {
    return c.json(await getCustomer(c.req.valid("param").id), 200);
  })
  .openapi(adminTrips, async (c) => {
    return c.json(await listCustomerTrips(c.req.valid("param").id, c.req.valid("query")), 200);
  });
