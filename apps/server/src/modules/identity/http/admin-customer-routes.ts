import { createRoute } from "@hono/zod-openapi";
import { CustomerStatusChange, IdParam } from "@terhal/contracts";
import type { Context } from "hono";
import {
  ADMIN_COOKIE_AUTH,
  currentAdminId,
  requireAdmin,
} from "../../../platform/http/authenticate";
import { body, createRouter, problemResponse } from "../../../platform/http/router";
import { createRateLimitKey, rateLimit } from "../../../platform/rate-limit/rate-limit";
import { reactivateCustomer, suspendCustomer } from "../application/customer-suspension";
import { requestInfo } from "./request-info";

// Suspending and reactivating customers: admin panel only. Staff view customers but can't change them. The customer
// list and details come from the customers module.

const MINUTE = 60 * 1000;

const tags = ["Admin customers"];
const security = [{ [ADMIN_COOKIE_AUTH]: [] }];

const admin = (scope: string) => [
  requireAdmin,
  rateLimit({
    limit: 60,
    windowMs: 15 * MINUTE,
    key: (c: Context) => createRateLimitKey(scope, "user", currentAdminId(c)),
  }),
];

const errors = {
  400: problemResponse("VALIDATION_FAILED: a reason is required."),
  401: problemResponse("UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in."),
  403: problemResponse("ACCOUNT_NOT_ACTIVE"),
  404: problemResponse("NOT_FOUND: no customer with this id."),
  409: problemResponse("ACCOUNT_DELETED: the customer was deleted."),
  429: problemResponse("RATE_LIMITED: see the Retry-After header."),
};

const suspend = createRoute({
  method: "post",
  path: "/admin/customers/{id}/suspend",
  tags,
  summary: "Suspend a customer",
  description:
    "Signs them out everywhere at once and blocks signing in and booking. Their upcoming trips are left as they are. The reason is kept in the audit log. Suspending a suspended customer changes nothing.",
  middleware: admin("admin:customers:suspend"),
  security,
  request: { params: IdParam, ...body(CustomerStatusChange) },
  responses: { 204: { description: "Suspended" }, ...errors },
});

const reactivate = createRoute({
  method: "post",
  path: "/admin/customers/{id}/reactivate",
  tags,
  summary: "Reactivate a suspended customer",
  description:
    "They can sign in again (or finish verifying, if they never did). The reason is kept in the audit log. Reactivating a customer who isn't suspended changes nothing.",
  middleware: admin("admin:customers:reactivate"),
  security,
  request: { params: IdParam, ...body(CustomerStatusChange) },
  responses: { 204: { description: "Reactivated" }, ...errors },
});

const change = (c: Context, customerId: string, reason: string) => ({
  customerId,
  reason,
  adminId: currentAdminId(c),
  ipAddress: requestInfo(c).ipAddress,
});

export const adminCustomerStatusRoutes = createRouter()
  .openapi(suspend, async (c) => {
    await suspendCustomer(change(c, c.req.valid("param").id, c.req.valid("json").reason));
    return c.body(null, 204);
  })
  .openapi(reactivate, async (c) => {
    await reactivateCustomer(change(c, c.req.valid("param").id, c.req.valid("json").reason));
    return c.body(null, 204);
  });
