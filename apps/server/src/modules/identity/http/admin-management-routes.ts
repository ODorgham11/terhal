import { createRoute } from "@hono/zod-openapi";
import { AdminAccount, AdminStepUp, IdParam, page } from "@terhal/contracts";
import type { Context } from "hono";
import {
  ADMIN_COOKIE_AUTH,
  currentAdminId,
  requireAdmin,
} from "../../../platform/http/authenticate";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
import { createRateLimitKey, rateLimit } from "../../../platform/rate-limit/rate-limit";
import { deactivateAdmin, listAdmins, reactivateAdmin } from "../application/admin-management";
import { resetTwoFactor } from "../application/admin-two-factor-reset";
import { requestInfo } from "./request-info";

const MINUTE = 60 * 1000;

const tags = ["Admins"];
const security = [{ [ADMIN_COOKIE_AUTH]: [] }];
const perAdmin = (scope: string) => (c: Context) =>
  createRateLimitKey(scope, "user", currentAdminId(c));

const signedIn = {
  401: problemResponse("UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in."),
  403: problemResponse("ACCOUNT_NOT_ACTIVE"),
  429: problemResponse("RATE_LIMITED: see the Retry-After header."),
};
const notFound = problemResponse("NOT_FOUND: no admin with this id.");

const list = createRoute({
  method: "get",
  path: "/admin/admins",
  tags,
  summary: "List admins",
  description: "Every admin, active or not, oldest first, in one page.",
  middleware: [
    requireAdmin,
    rateLimit({ limit: 120, windowMs: MINUTE, key: perAdmin("admin:admins:list") }),
  ] as const,
  security,
  responses: {
    200: { description: "The admins", ...json(page(AdminAccount)) },
    ...signedIn,
  },
});

// Another admin has to do it, and never to the last active one, so someone can always sign in.
const deactivate = createRoute({
  method: "post",
  path: "/admin/admins/{id}/deactivate",
  tags,
  summary: "Deactivate an admin",
  description:
    "Takes a current code from your authenticator. Signs the admin out everywhere at once. Deactivating an inactive admin changes nothing.",
  middleware: [
    requireAdmin,
    rateLimit({ limit: 20, windowMs: 60 * MINUTE, key: perAdmin("admin:admins:deactivate") }),
  ] as const,
  security,
  request: { params: IdParam, ...body(AdminStepUp) },
  responses: {
    204: { description: "Deactivated" },
    400: problemResponse(
      "CANNOT_TARGET_SELF, TOTP_CODE_INVALID or VALIDATION_FAILED. Deactivate yourself by asking another admin.",
    ),
    ...signedIn,
    403: problemResponse("ACCOUNT_NOT_ACTIVE or TOTP_SETUP_REQUIRED"),
    404: notFound,
    409: problemResponse("LAST_ACTIVE_ADMIN: nobody else would be able to sign in."),
  },
});

const reactivate = createRoute({
  method: "post",
  path: "/admin/admins/{id}/reactivate",
  tags,
  summary: "Reactivate an admin",
  description: "They can sign in again. Reactivating an active admin changes nothing.",
  middleware: [
    requireAdmin,
    rateLimit({ limit: 20, windowMs: 60 * MINUTE, key: perAdmin("admin:admins:reactivate") }),
  ] as const,
  security,
  request: { params: IdParam },
  responses: {
    204: { description: "Reactivated" },
    ...signedIn,
    404: notFound,
  },
});

// For an admin who lost their authenticator: they're emailed a link to set up a new one, then confirm it with their
// password at /v1/admin/auth/two-factor/setup and /confirm.
const resetTwoFactorRoute = createRoute({
  method: "post",
  path: "/admin/admins/{id}/reset/two-factor",
  tags,
  summary: "Reset an admin's two-factor authentication",
  description:
    "Takes a current code from your authenticator. Their authenticator stops working and every session of theirs ends; they're emailed a link, valid 48 hours, to set up a new one.",
  middleware: [
    requireAdmin,
    rateLimit({ limit: 10, windowMs: 60 * MINUTE, key: perAdmin("admin:admins:reset-two-factor") }),
  ] as const,
  security,
  request: { params: IdParam, ...body(AdminStepUp) },
  responses: {
    204: { description: "Reset, and the link sent" },
    400: problemResponse("CANNOT_TARGET_SELF, TOTP_CODE_INVALID or VALIDATION_FAILED"),
    ...signedIn,
    403: problemResponse("ACCOUNT_NOT_ACTIVE or TOTP_SETUP_REQUIRED"),
    404: notFound,
    409: problemResponse("ADMIN_NOT_ACTIVE: reactivate them first."),
    503: problemResponse(
      "SERVICE_UNAVAILABLE: reset, but the email couldn't be sent. Reset again to send a new link.",
    ),
  },
});

export const adminManagementRoutes = createRouter()
  .openapi(list, async (c) => {
    return c.json(await listAdmins(), 200);
  })
  .openapi(deactivate, async (c) => {
    await deactivateAdmin(
      c.req.valid("param").id,
      c.req.valid("json").code,
      currentAdminId(c),
      requestInfo(c).ipAddress,
    );
    return c.body(null, 204);
  })
  .openapi(reactivate, async (c) => {
    await reactivateAdmin(c.req.valid("param").id, currentAdminId(c), requestInfo(c).ipAddress);
    return c.body(null, 204);
  })
  .openapi(resetTwoFactorRoute, async (c) => {
    await resetTwoFactor(
      c.req.valid("param").id,
      c.req.valid("json").code,
      currentAdminId(c),
      requestInfo(c).ipAddress,
    );
    return c.body(null, 204);
  });
