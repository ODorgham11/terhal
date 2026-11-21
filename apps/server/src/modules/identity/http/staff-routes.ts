import { createRoute } from "@hono/zod-openapi";
import {
  AcceptStaffInvitation,
  CompleteStaffPasswordReset,
  InviteStaff,
  RequestStaffPasswordReset,
  Staff,
  StaffInvitationPreview,
  StaffInvitationSent,
  StaffInvitationToken,
  StaffSignIn,
} from "@terhal/contracts";
import { AppError } from "../../../platform/errors/app-error";
import {
  STAFF_COOKIE_AUTH,
  clearSession,
  currentStaff,
  refreshTokenOf,
  requirePermission,
  requireStaff,
  setSession,
} from "../../../platform/http/authenticate";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
import {
  bodyKey,
  createRateLimitKey,
  ipKey,
  rateLimit,
} from "../../../platform/rate-limit/rate-limit";
import { currentStaffMember } from "../application/staff";
import {
  acceptStaffInvitation,
  inviteStaff,
  previewStaffInvitation,
} from "../application/staff-invitations";
import {
  completeStaffPasswordReset,
  requestStaffPasswordReset,
} from "../application/staff-password-reset";
import {
  createStaffSession,
  refreshStaffSession,
  signOutStaff,
} from "../application/staff-sessions";
import { signInStaff } from "../application/staff-sign-in";
import { requestInfo } from "./request-info";

const MINUTE = 60 * 1000;

const authTags = ["Staff auth"];
const invitationTags = ["Staff invitations"];
const security = [{ [STAFF_COOKIE_AUTH]: [] }];
const sessionCookies = {
  "Set-Cookie": {
    description: "The access and refresh cookies (httpOnly; the web app never reads them).",
    schema: { type: "string" as const },
  },
};
const rateLimited = problemResponse("RATE_LIMITED: see the Retry-After header.");
const invitationUnusable = problemResponse("INVITATION_INVALID or INVITATION_EXPIRED");

const signIn = createRoute({
  method: "post",
  path: "/staff/auth/sign-in",
  tags: authTags,
  summary: "Sign in with email and password",
  description:
    "Sets the session cookies. A session lasts 7 days from its last refresh and 30 days at most.",
  middleware: [
    rateLimit({ limit: 10, windowMs: 15 * MINUTE, key: ipKey("staff:sign-in") }),
    rateLimit({
      limit: 5,
      windowMs: 15 * MINUTE,
      key: bodyKey("staff:sign-in", "identifier", "email"),
    }),
  ] as const,
  request: body(StaffSignIn),
  responses: {
    200: { description: "Signed in", headers: sessionCookies, ...json(Staff) },
    400: problemResponse("VALIDATION_FAILED"),
    401: problemResponse(
      "INVALID_CREDENTIALS: the same for an unknown email and a wrong password.",
    ),
    403: problemResponse("ACCOUNT_NOT_ACTIVE"),
    429: rateLimited,
  },
});

const refresh = createRoute({
  method: "post",
  path: "/staff/auth/refresh",
  tags: authTags,
  summary: "Renew the session cookies",
  description: "Uses the refresh cookie and rotates it. Send one refresh at a time.",
  middleware: [
    rateLimit({ limit: 60, windowMs: 15 * MINUTE, key: ipKey("staff:refresh") }),
  ] as const,
  security,
  responses: {
    204: { description: "New cookies set", headers: sessionCookies },
    401: problemResponse("INVALID_REFRESH_TOKEN: sign in again."),
    403: problemResponse("ACCOUNT_NOT_ACTIVE"),
    429: rateLimited,
  },
});

const signOut = createRoute({
  method: "post",
  path: "/staff/auth/sign-out",
  tags: authTags,
  summary: "Sign out",
  description:
    "Ends the session the refresh cookie belongs to and clears the cookies. Always succeeds.",
  security,
  responses: { 204: { description: "Signed out" } },
});

const session = createRoute({
  method: "get",
  path: "/staff/auth/session",
  tags: authTags,
  summary: "The signed in staff member",
  description: "Includes their permissions, so the dashboard can hide what they can't use.",
  middleware: [requireStaff] as const,
  security,
  responses: {
    200: { description: "The staff member", ...json(Staff) },
    401: problemResponse("UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in."),
    403: problemResponse("ACCOUNT_NOT_ACTIVE"),
  },
});

const requestPasswordReset = createRoute({
  method: "post",
  path: "/staff/auth/password/reset/request",
  tags: authTags,
  summary: "Email a password reset link",
  description:
    "Always accepted, so it never reveals whether the email belongs to staff. The link lasts an hour, and asking again replaces it.",
  middleware: [
    rateLimit({ limit: 10, windowMs: 15 * MINUTE, key: ipKey("staff:password-reset") }),
    rateLimit({
      limit: 3,
      windowMs: 60 * MINUTE,
      key: bodyKey("staff:password-reset", "identifier", "email"),
    }),
  ] as const,
  request: body(RequestStaffPasswordReset),
  responses: {
    202: { description: "If the email belongs to an active staff member, a link is on its way" },
    400: problemResponse("VALIDATION_FAILED"),
    429: rateLimited,
  },
});

const completePasswordReset = createRoute({
  method: "post",
  path: "/staff/auth/password/reset/complete",
  tags: authTags,
  summary: "Choose a new password",
  description: "Uses the link up and signs the staff member out everywhere.",
  middleware: [
    rateLimit({ limit: 10, windowMs: 15 * MINUTE, key: ipKey("staff:password-reset:complete") }),
  ] as const,
  request: body(CompleteStaffPasswordReset),
  responses: {
    204: { description: "Password changed; sign in with it" },
    400: problemResponse("PASSWORD_RESET_INVALID, PASSWORD_RESET_EXPIRED or VALIDATION_FAILED"),
    429: rateLimited,
  },
});

const lookupInvitation = createRoute({
  method: "get",
  path: "/staff/invitations/lookup",
  tags: invitationTags,
  summary: "Look up an invitation",
  description: "What the invitee sees before accepting. Doesn't use the invitation up.",
  middleware: [
    rateLimit({ limit: 30, windowMs: 15 * MINUTE, key: ipKey("staff:invitation:lookup") }),
  ] as const,
  request: { query: StaffInvitationToken },
  responses: {
    200: { description: "The invitation can be accepted", ...json(StaffInvitationPreview) },
    400: invitationUnusable,
    429: rateLimited,
  },
});

// Creates the account and signs the new staff member in, since they've just chosen their password.
const acceptInvitation = createRoute({
  method: "post",
  path: "/staff/invitations/accept",
  tags: invitationTags,
  summary: "Create a staff account from an invitation",
  description: "The account gets the email and the permissions the invitation was sent with.",
  middleware: [
    rateLimit({ limit: 10, windowMs: 60 * MINUTE, key: ipKey("staff:invitation:accept") }),
  ] as const,
  request: body(AcceptStaffInvitation),
  responses: {
    201: { description: "Account created and signed in", headers: sessionCookies, ...json(Staff) },
    400: problemResponse("INVITATION_INVALID, INVITATION_EXPIRED or VALIDATION_FAILED"),
    409: problemResponse("ACCOUNT_ALREADY_EXISTS"),
    429: rateLimited,
  },
});

const sendInvitation = createRoute({
  method: "post",
  path: "/staff/invitations",
  tags: invitationTags,
  summary: "Invite a colleague",
  description:
    "Needs the team permission. Emails a link that lasts 7 days; inviting the same email again revokes the earlier links.",
  middleware: [
    requireStaff,
    requirePermission("team"),
    rateLimit({
      limit: 30,
      windowMs: 60 * MINUTE,
      key: (c) => createRateLimitKey("staff:invite", "user", currentStaff(c).staffId),
    }),
  ] as const,
  security,
  request: body(InviteStaff),
  responses: {
    201: { description: "Invitation sent", ...json(StaffInvitationSent) },
    400: problemResponse("VALIDATION_FAILED"),
    401: problemResponse("UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in."),
    403: problemResponse("ACCOUNT_NOT_ACTIVE or FORBIDDEN"),
    409: problemResponse("ACCOUNT_ALREADY_EXISTS: the email already belongs to a staff member."),
    429: rateLimited,
    503: problemResponse("SERVICE_UNAVAILABLE: the email couldn't be sent."),
  },
});

export const staffAuthRoutes = createRouter()
  .openapi(signIn, async (c) => {
    const { email, password } = c.req.valid("json");
    const signedIn = await signInStaff(email, password);
    const { staff, session } = await createStaffSession(signedIn, requestInfo(c));

    setSession(c, "staff", session);
    return c.json(staff, 200);
  })
  .openapi(refresh, async (c) => {
    try {
      setSession(c, "staff", await refreshStaffSession(refreshTokenOf(c, "staff"), requestInfo(c)));
    } catch (error) {
      // Clear the cookies when the session is over, so the browser stops sending them.
      if (error instanceof AppError && (error.status === 401 || error.status === 403)) {
        clearSession(c, "staff");
      }
      throw error;
    }
    return c.body(null, 204);
  })
  .openapi(signOut, async (c) => {
    await signOutStaff(refreshTokenOf(c, "staff"));

    clearSession(c, "staff");
    return c.body(null, 204);
  })
  .openapi(session, async (c) => {
    return c.json(await currentStaffMember(c.var.staff.staffId), 200);
  })
  .openapi(requestPasswordReset, async (c) => {
    await requestStaffPasswordReset(c.req.valid("json").email);
    return c.body(null, 202);
  })
  .openapi(completePasswordReset, async (c) => {
    const { token, password } = c.req.valid("json");
    await completeStaffPasswordReset(token, password);
    return c.body(null, 204);
  })
  .openapi(lookupInvitation, async (c) => {
    return c.json(await previewStaffInvitation(c.req.valid("query").token), 200);
  })
  .openapi(acceptInvitation, async (c) => {
    const created = await acceptStaffInvitation(c.req.valid("json"));
    const { staff, session } = await createStaffSession(created, requestInfo(c));

    setSession(c, "staff", session);
    return c.json(staff, 201);
  })
  .openapi(sendInvitation, async (c) => {
    const sent = await inviteStaff(
      c.req.valid("json"),
      currentStaff(c).staffId,
      requestInfo(c).ipAddress,
    );
    return c.json(sent, 201);
  });
