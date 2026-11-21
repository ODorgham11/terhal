import { createRoute } from "@hono/zod-openapi";
import {
  Admin,
  AdminSession,
  ChangeAdminPassword,
  CompleteAdminPasswordReset,
  ConfirmTwoFactorReset,
  IdParam,
  RequestAdminPasswordReset,
  TotpSetup,
  TwoFactorResetToken,
  page,
} from "@terhal/contracts";
import type { Context } from "hono";
import {
  ADMIN_COOKIE_AUTH,
  clearAdminSession,
  currentAdminId,
  currentAdminSessionId,
  requireAdmin,
  setAdminSession,
} from "../../../platform/http/authenticate";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
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
import { confirmTwoFactorReset, startTwoFactorSetup } from "../application/admin-two-factor-reset";
import {
  createSession,
  listSessions,
  revokeOtherSessions,
  revokeOwnSession,
} from "../application/sessions";
import { requestInfo } from "./request-info";

const MINUTE = 60 * 1000;

const tags = ["Admin auth"];
const security = [{ [ADMIN_COOKIE_AUTH]: [] }];
const sessionCookies = {
  "Set-Cookie": {
    description: "The access and refresh cookies (httpOnly; the web app never reads them).",
    schema: { type: "string" as const },
  },
};
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

const sessions = createRoute({
  method: "get",
  path: "/admin/auth/sessions",
  tags,
  summary: "List your sessions",
  description: "Your active sessions, newest first, in one page. `current` marks this one.",
  middleware: [
    requireAdmin,
    rateLimit({ limit: 120, windowMs: MINUTE, key: perAdmin("admin:sessions:list") }),
  ] as const,
  security,
  responses: {
    200: { description: "Your active sessions", ...json(page(AdminSession)) },
    ...signedIn,
  },
});

const revokeSession = createRoute({
  method: "delete",
  path: "/admin/auth/sessions/{id}",
  tags,
  summary: "End one of your sessions",
  description: "Ending the current session also clears its cookies, like signing out.",
  middleware: [
    requireAdmin,
    rateLimit({ limit: 60, windowMs: 15 * MINUTE, key: perAdmin("admin:sessions:revoke") }),
  ] as const,
  security,
  request: { params: IdParam },
  responses: {
    204: { description: "Session ended" },
    ...signedIn,
    404: problemResponse("NOT_FOUND: no such active session of yours."),
  },
});

const revokeOthers = createRoute({
  method: "post",
  path: "/admin/auth/sessions/all/revoke",
  tags,
  summary: "Sign out everywhere else",
  description: "Ends every session of yours except this one.",
  middleware: [
    requireAdmin,
    rateLimit({ limit: 20, windowMs: 15 * MINUTE, key: perAdmin("admin:sessions:revoke-all") }),
  ] as const,
  security,
  responses: {
    204: { description: "Every other session ended" },
    ...signedIn,
  },
});

const resetUnusable = "TWO_FACTOR_RESET_INVALID or TWO_FACTOR_RESET_EXPIRED";

// After another admin resets their two-factor, the emailed link leads here: the same two steps as accepting an invitation.
const twoFactorSetup = createRoute({
  method: "post",
  path: "/admin/auth/two-factor/setup",
  tags,
  summary: "Get a new authenticator secret after a two-factor reset",
  description:
    "Asking again returns the same secret, so an app that's already set up keeps working. Not accepted at sign in until confirmed.",
  middleware: [
    rateLimit({ limit: 20, windowMs: 60 * MINUTE, key: ipKey("admin:two-factor:setup") }),
  ] as const,
  request: body(TwoFactorResetToken),
  responses: {
    200: { description: "Show the URI as a QR code", ...json(TotpSetup) },
    400: problemResponse(`${resetUnusable} or VALIDATION_FAILED`),
    403: problemResponse("ACCOUNT_NOT_ACTIVE"),
    429: rateLimited,
  },
});

const twoFactorConfirm = createRoute({
  method: "post",
  path: "/admin/auth/two-factor/confirm",
  tags,
  summary: "Confirm the new authenticator and sign in",
  description:
    "Needs the admin's password and a current code from the authenticator set up with /v1/admin/auth/two-factor/setup.",
  middleware: [
    rateLimit({ limit: 10, windowMs: 15 * MINUTE, key: ipKey("admin:two-factor:confirm") }),
    rateLimit({
      limit: 5,
      windowMs: 15 * MINUTE,
      key: bodyKey("admin:two-factor:confirm", "identifier", "token"),
    }),
  ] as const,
  request: body(ConfirmTwoFactorReset),
  responses: {
    200: {
      description: "Two-factor set up and signed in",
      headers: sessionCookies,
      ...json(Admin),
    },
    400: problemResponse(
      `${resetUnusable}, TOTP_SETUP_REQUIRED, TOTP_CODE_INVALID or VALIDATION_FAILED`,
    ),
    401: problemResponse("INVALID_CREDENTIALS: the password is wrong."),
    403: problemResponse("ACCOUNT_NOT_ACTIVE"),
    429: rateLimited,
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
  })
  .openapi(sessions, async (c) => {
    return c.json(await listSessions(currentAdminId(c), currentAdminSessionId(c)), 200);
  })
  .openapi(revokeSession, async (c) => {
    const { id } = c.req.valid("param");
    await revokeOwnSession(currentAdminId(c), id, requestInfo(c).ipAddress);

    // Ending the session making the request is signing out, so the browser stops sending its cookies.
    if (id === currentAdminSessionId(c)) clearAdminSession(c);
    return c.body(null, 204);
  })
  .openapi(revokeOthers, async (c) => {
    await revokeOtherSessions(
      currentAdminId(c),
      currentAdminSessionId(c),
      requestInfo(c).ipAddress,
    );
    return c.body(null, 204);
  })
  .openapi(twoFactorSetup, async (c) => {
    const { token } = c.req.valid("json");
    return c.json(await startTwoFactorSetup(token, requestInfo(c).ipAddress), 200);
  })
  .openapi(twoFactorConfirm, async (c) => {
    const request = requestInfo(c);
    const confirmed = await confirmTwoFactorReset(c.req.valid("json"), request.ipAddress);
    const { admin, session } = await createSession(confirmed, "two_factor_reset", request);

    setAdminSession(c, session);
    return c.json(admin, 200);
  });
