import { createRoute } from "@hono/zod-openapi";
import {
  AccountSession,
  ChangePassword,
  IdParam,
  Staff,
  UpdateStaffAccount,
  page,
} from "@terhal/contracts";
import type { Context } from "hono";
import {
  STAFF_COOKIE_AUTH,
  clearSession,
  currentStaff,
  requireStaff,
} from "../../../platform/http/authenticate";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
import { createRateLimitKey, rateLimit } from "../../../platform/rate-limit/rate-limit";
import { changeStaffPassword, updateStaffAccount } from "../application/staff-account";
import {
  listStaffSessions,
  revokeAllStaffSessions,
  revokeOwnStaffSession,
} from "../application/staff-sessions";
import { requestInfo } from "./request-info";

// A signed in staff member's own account: their details, password and sessions. Like the admin's, without the
// authenticator code, since staff have none.

const MINUTE = 60 * 1000;

const security = [{ [STAFF_COOKIE_AUTH]: [] }];

const signedIn = (scope: string, limit: number, windowMs: number) => [
  requireStaff,
  rateLimit({
    limit,
    windowMs,
    key: (c: Context) => createRateLimitKey(scope, "user", currentStaff(c).staffId),
  }),
];

const signedInErrors = {
  401: problemResponse("UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in."),
  403: problemResponse("ACCOUNT_NOT_ACTIVE"),
  429: problemResponse("RATE_LIMITED: see the Retry-After header."),
};

const updateAccount = createRoute({
  method: "patch",
  path: "/staff/account",
  tags: ["Staff account"],
  summary: "Change your name, phone or language",
  description:
    "Only the fields sent change; a null phone removes it. Emails and notifications go out in `locale`.",
  middleware: signedIn("staff:account:update", 30, 15 * MINUTE),
  security,
  request: body(UpdateStaffAccount),
  responses: {
    200: { description: "Your account", ...json(Staff) },
    400: problemResponse("VALIDATION_FAILED"),
    ...signedInErrors,
  },
});

const authTags = ["Staff auth"];

const changePassword = createRoute({
  method: "post",
  path: "/staff/auth/password",
  tags: authTags,
  summary: "Change your password",
  description: "Takes the current password. Signs you out everywhere else; this session stays.",
  middleware: signedIn("staff:password:change", 5, 15 * MINUTE),
  security,
  request: body(ChangePassword),
  responses: {
    204: { description: "Password changed" },
    400: problemResponse("VALIDATION_FAILED"),
    ...signedInErrors,
    401: problemResponse(
      "INVALID_CREDENTIALS: the current password is wrong. UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in.",
    ),
  },
});

const sessions = createRoute({
  method: "get",
  path: "/staff/auth/sessions",
  tags: authTags,
  summary: "List your sessions",
  description: "Your active sessions, newest first, in one page. `current` marks this one.",
  middleware: signedIn("staff:sessions:list", 120, MINUTE),
  security,
  responses: {
    200: { description: "Your active sessions", ...json(page(AccountSession)) },
    ...signedInErrors,
  },
});

const revokeSession = createRoute({
  method: "delete",
  path: "/staff/auth/sessions/{id}",
  tags: authTags,
  summary: "End one of your sessions",
  description: "Ending the current session also clears its cookies, like signing out.",
  middleware: signedIn("staff:sessions:revoke", 60, 15 * MINUTE),
  security,
  request: { params: IdParam },
  responses: {
    204: { description: "Session ended" },
    ...signedInErrors,
    404: problemResponse("NOT_FOUND: no such active session of yours."),
  },
});

const revokeOthers = createRoute({
  method: "post",
  path: "/staff/auth/sessions/all/revoke",
  tags: authTags,
  summary: "Sign out everywhere else",
  description: "Ends every session of yours except this one.",
  middleware: signedIn("staff:sessions:revoke-all", 20, 15 * MINUTE),
  security,
  responses: { 204: { description: "Every other session ended" }, ...signedInErrors },
});

export const staffAccountRoutes = createRouter()
  .openapi(updateAccount, async (c) => {
    return c.json(await updateStaffAccount(currentStaff(c).staffId, c.req.valid("json")), 200);
  })
  .openapi(changePassword, async (c) => {
    const { staffId, sessionId } = currentStaff(c);
    await changeStaffPassword(
      c.req.valid("json"),
      { staffId, sessionId },
      requestInfo(c).ipAddress,
    );
    return c.body(null, 204);
  })
  .openapi(sessions, async (c) => {
    const { staffId, sessionId } = currentStaff(c);
    return c.json(await listStaffSessions(staffId, sessionId), 200);
  })
  .openapi(revokeSession, async (c) => {
    const { id } = c.req.valid("param");
    const { staffId, sessionId } = currentStaff(c);
    await revokeOwnStaffSession(staffId, id);

    // Ending the session making the request is signing out, so the browser stops sending its cookies.
    if (id === sessionId) clearSession(c, "staff");
    return c.body(null, 204);
  })
  .openapi(revokeOthers, async (c) => {
    const { staffId, sessionId } = currentStaff(c);
    await revokeAllStaffSessions(staffId, undefined, sessionId);
    return c.body(null, 204);
  });
