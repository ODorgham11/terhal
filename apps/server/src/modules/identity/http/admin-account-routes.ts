import { createRoute } from "@hono/zod-openapi";
import {
  ChangeAdminPassword,
  CompleteAdminPasswordReset,
  RequestAdminPasswordReset,
} from "@terhal/contracts";
import type { Context } from "hono";
import {
  ADMIN_COOKIE_AUTH,
  currentAdminId,
  currentAdminSessionId,
  requireAdmin,
} from "../../../platform/http/authenticate";
import { body, createRouter, problemResponse } from "../../../platform/http/router";
import {
  bodyKey,
  createRateLimitKey,
  ipKey,
  rateLimit,
} from "../../../platform/rate-limit/rate-limit";
import {
  changeAdminPassword,
  completeAdminPasswordReset,
  requestAdminPasswordReset,
} from "../application/admin-password";
import { requestInfo } from "./request-info";

const MINUTE = 60 * 1000;

const tags = ["Admin auth"];
const security = [{ [ADMIN_COOKIE_AUTH]: [] }];
const rateLimited = problemResponse("RATE_LIMITED: see the Retry-After header.");
const perAdmin = (scope: string) => (c: Context) =>
  createRateLimitKey(scope, "user", currentAdminId(c));

const signedIn = {
  401: problemResponse("UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in."),
  403: problemResponse("ACCOUNT_NOT_ACTIVE"),
  429: rateLimited,
};

// Forgotten passwords. Always the same answer, so it can't be used to find out which emails belong to admins.
const requestPasswordReset = createRoute({
  method: "post",
  path: "/admin/auth/password/reset/request",
  tags,
  summary: "Email a password reset link",
  description:
    "Always 202, whether or not the email belongs to an active admin. The link lasts 15 minutes, and a new request replaces it.",
  middleware: [
    rateLimit({ limit: 10, windowMs: 15 * MINUTE, key: ipKey("admin:password-reset") }),
    rateLimit({
      limit: 3,
      windowMs: 15 * MINUTE,
      key: bodyKey("admin:password-reset", "identifier", "email"),
    }),
  ] as const,
  request: body(RequestAdminPasswordReset),
  responses: {
    202: { description: "If the email belongs to an active admin, a link is on its way" },
    400: problemResponse("VALIDATION_FAILED"),
    429: rateLimited,
  },
});

const completePasswordReset = createRoute({
  method: "post",
  path: "/admin/auth/password/reset/complete",
  tags,
  summary: "Choose a new password from a reset link",
  description:
    "Takes a current code from the admin's authenticator too, so the inbox alone isn't enough. Signs the admin out everywhere.",
  middleware: [
    rateLimit({ limit: 10, windowMs: 15 * MINUTE, key: ipKey("admin:password-reset:complete") }),
    rateLimit({
      limit: 5,
      windowMs: 15 * MINUTE,
      key: bodyKey("admin:password-reset:complete", "identifier", "token"),
    }),
  ] as const,
  request: body(CompleteAdminPasswordReset),
  responses: {
    204: { description: "Password changed" },
    400: problemResponse(
      "PASSWORD_RESET_INVALID, PASSWORD_RESET_EXPIRED, TOTP_CODE_INVALID or VALIDATION_FAILED",
    ),
    403: problemResponse(
      "ACCOUNT_NOT_ACTIVE, or TOTP_SETUP_REQUIRED while the admin's two-factor is being reset.",
    ),
    429: rateLimited,
  },
});

const changePassword = createRoute({
  method: "post",
  path: "/admin/auth/password",
  tags,
  summary: "Change your password",
  description:
    "Takes the current password and a current authenticator code. Signs you out everywhere else; this session stays.",
  middleware: [
    requireAdmin,
    rateLimit({ limit: 5, windowMs: 15 * MINUTE, key: perAdmin("admin:password:change") }),
  ] as const,
  security,
  request: body(ChangeAdminPassword),
  responses: {
    204: { description: "Password changed" },
    400: problemResponse("TOTP_CODE_INVALID or VALIDATION_FAILED"),
    ...signedIn,
    401: problemResponse(
      "INVALID_CREDENTIALS: the current password is wrong. UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in.",
    ),
  },
});

export const adminAccountRoutes = createRouter()
  .openapi(requestPasswordReset, async (c) => {
    await requestAdminPasswordReset(c.req.valid("json").email, requestInfo(c).ipAddress);
    return c.body(null, 202);
  })
  .openapi(completePasswordReset, async (c) => {
    await completeAdminPasswordReset(c.req.valid("json"), requestInfo(c).ipAddress);
    return c.body(null, 204);
  })
  .openapi(changePassword, async (c) => {
    await changeAdminPassword(
      c.req.valid("json"),
      { adminId: currentAdminId(c), sessionId: currentAdminSessionId(c) },
      requestInfo(c).ipAddress,
    );
    return c.body(null, 204);
  });
