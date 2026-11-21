import { createRoute } from "@hono/zod-openapi";
import {
  AcceptAdminInvitation,
  Admin,
  AdminChallenge,
  AdminInvitationPreview,
  AdminInvitationToken,
  AdminSignIn,
  AdminVerify,
  TotpSetup,
} from "@terhal/contracts";
import type { Context } from "hono";
import { AppError } from "../../../platform/errors/app-error";
import {
  ADMIN_COOKIE_AUTH,
  adminChallenge,
  adminRefreshToken,
  clearAdminChallenge,
  clearAdminSession,
  requireAdmin,
  setAdminChallenge,
  setAdminSession,
} from "../../../platform/http/authenticate";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
import {
  bodyKey,
  createRateLimitKey,
  getClientIp,
  ipKey,
  rateLimit,
} from "../../../platform/rate-limit/rate-limit";
import {
  acceptInvitation,
  previewInvitation,
  startTotpSetup,
} from "../application/admin-invitations";
import { checkPassword, verifySignIn } from "../application/admin-sign-in";
import { currentAdmin } from "../application/admins";
import { createSession, refreshSession, signOut } from "../application/sessions";

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
const invitationUnusable = problemResponse("INVITATION_INVALID or INVITATION_EXPIRED");

// Falls back to the connection's address when there's no proxy header (e.g. locally), so audit records always have an IP.
const requestInfo = (c: Context) => {
  const ip = getClientIp(c);
  return { ipAddress: ip === "unknown" ? null : ip, userAgent: c.req.header("user-agent") ?? null };
};

// Limits code guesses per admin, not just per IP, so spreading guesses across many IPs doesn't help. Only a genuine
// challenge counts: an unchecked one could name any admin and use up their attempts.
const challengeKey = (scope: string) => async (c: Context) => {
  const adminId = await adminChallenge(c);
  return adminId ? createRateLimitKey(scope, "user", adminId) : undefined;
};

const lookupInvitation = createRoute({
  method: "get",
  path: "/admin/invitations/lookup",
  tags,
  summary: "Look up an invitation",
  description: "What the invitee sees before accepting. Doesn't use the invitation up.",
  middleware: [
    rateLimit({ limit: 30, windowMs: 15 * MINUTE, key: ipKey("admin:invitation:lookup") }),
  ] as const,
  request: { query: AdminInvitationToken },
  responses: {
    200: { description: "The invitation can be accepted", ...json(AdminInvitationPreview) },
    400: invitationUnusable,
    429: rateLimited,
  },
});

const invitationTotp = createRoute({
  method: "post",
  path: "/admin/invitations/totp",
  tags,
  summary: "Get the invitee's authenticator secret",
  description:
    "Asking again returns the same secret, so an app that's already set up keeps working.",
  middleware: [
    rateLimit({ limit: 20, windowMs: 60 * MINUTE, key: ipKey("admin:invitation:totp") }),
  ] as const,
  request: body(AdminInvitationToken),
  responses: {
    200: { description: "Show the URI as a QR code", ...json(TotpSetup) },
    400: invitationUnusable,
    429: rateLimited,
  },
});

// Creates the account and signs the new admin in, since they've just proven both their password and their authenticator.
const accept = createRoute({
  method: "post",
  path: "/admin/invitations/accept",
  tags,
  summary: "Create an admin account from an invitation",
  description:
    "Needs a current code from the authenticator set up with /v1/admin/invitations/totp.",
  middleware: [
    rateLimit({ limit: 10, windowMs: 60 * MINUTE, key: ipKey("admin:invitation:accept") }),
  ] as const,
  request: body(AcceptAdminInvitation),
  responses: {
    201: { description: "Account created and signed in", headers: sessionCookies, ...json(Admin) },
    400: problemResponse(
      "INVITATION_INVALID, INVITATION_EXPIRED, TOTP_SETUP_REQUIRED, TOTP_CODE_INVALID or VALIDATION_FAILED",
    ),
    409: problemResponse("ACCOUNT_ALREADY_EXISTS"),
    429: rateLimited,
  },
});

// Step one of signing in. A correct password only earns a short-lived challenge, never a session.
const signIn = createRoute({
  method: "post",
  path: "/admin/auth/sign-in",
  tags,
  summary: "Check email and password",
  description: "Sets a 5-minute challenge cookie. Always followed by /v1/admin/auth/verify.",
  middleware: [
    rateLimit({ limit: 10, windowMs: 15 * MINUTE, key: ipKey("admin:sign-in") }),
    rateLimit({
      limit: 5,
      windowMs: 15 * MINUTE,
      key: bodyKey("admin:sign-in", "identifier", "email"),
    }),
  ] as const,
  request: body(AdminSignIn),
  responses: {
    200: { description: "Password right; ask for a code", ...json(AdminChallenge) },
    400: problemResponse("VALIDATION_FAILED"),
    401: problemResponse(
      "INVALID_CREDENTIALS: the same for an unknown email and a wrong password.",
    ),
    403: problemResponse("ACCOUNT_NOT_ACTIVE or TOTP_SETUP_REQUIRED"),
    429: rateLimited,
  },
});

// Step two of signing in: the code from their authenticator app.
const verify = createRoute({
  method: "post",
  path: "/admin/auth/verify",
  tags,
  summary: "Finish signing in with an authenticator code",
  description:
    "Sets the session cookies. The session lasts 12 hours at most, however often it's refreshed.",
  middleware: [
    rateLimit({ limit: 10, windowMs: 15 * MINUTE, key: ipKey("admin:verify") }),
    rateLimit({ limit: 5, windowMs: 5 * MINUTE, key: challengeKey("admin:verify") }),
  ] as const,
  request: body(AdminVerify),
  responses: {
    200: { description: "Signed in", headers: sessionCookies, ...json(Admin) },
    400: problemResponse("TOTP_CODE_INVALID or VALIDATION_FAILED"),
    401: problemResponse("TOTP_CHALLENGE_INVALID: sign in again."),
    403: problemResponse("ACCOUNT_NOT_ACTIVE"),
    429: rateLimited,
  },
});

const refresh = createRoute({
  method: "post",
  path: "/admin/auth/refresh",
  tags,
  summary: "Renew the session cookies",
  description: "Uses the refresh cookie and rotates it. Send one refresh at a time.",
  middleware: [
    rateLimit({ limit: 60, windowMs: 15 * MINUTE, key: ipKey("admin:refresh") }),
  ] as const,
  security,
  responses: {
    204: { description: "New cookies set", headers: sessionCookies },
    401: problemResponse("INVALID_REFRESH_TOKEN: sign in again."),
    403: problemResponse("ACCOUNT_NOT_ACTIVE"),
    429: rateLimited,
  },
});

const signOutRoute = createRoute({
  method: "post",
  path: "/admin/auth/sign-out",
  tags,
  summary: "Sign out",
  description:
    "Ends the session the refresh cookie belongs to and clears the cookies. Always succeeds.",
  security,
  responses: { 204: { description: "Signed out" } },
});

const session = createRoute({
  method: "get",
  path: "/admin/auth/session",
  tags,
  summary: "The signed in admin",
  middleware: [requireAdmin] as const,
  security,
  responses: {
    200: { description: "The admin", ...json(Admin) },
    401: problemResponse("UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in."),
    403: problemResponse("ACCOUNT_NOT_ACTIVE"),
  },
});

export const adminAuthRoutes = createRouter()
  .openapi(lookupInvitation, async (c) => {
    return c.json(await previewInvitation(c.req.valid("query").token), 200);
  })
  .openapi(invitationTotp, async (c) => {
    const { token } = c.req.valid("json");
    return c.json(await startTotpSetup(token, requestInfo(c).ipAddress), 200);
  })
  .openapi(accept, async (c) => {
    const request = requestInfo(c);
    const created = await acceptInvitation(c.req.valid("json"), request.ipAddress);
    const { admin, session } = await createSession(created, "invitation", request);

    setAdminSession(c, session);
    return c.json(admin, 201);
  })
  .openapi(signIn, async (c) => {
    const { email, password } = c.req.valid("json");
    const admin = await checkPassword(email, password, requestInfo(c).ipAddress);

    await setAdminChallenge(c, admin.id);
    return c.json({ twoFactorRequired: true as const }, 200);
  })
  .openapi(verify, async (c) => {
    const request = requestInfo(c);
    const verified = await verifySignIn(
      await adminChallenge(c),
      c.req.valid("json").code,
      request.ipAddress,
    );
    const { admin, session } = await createSession(verified, "password_and_totp", request);

    clearAdminChallenge(c);
    setAdminSession(c, session);
    return c.json(admin, 200);
  })
  .openapi(refresh, async (c) => {
    try {
      setAdminSession(c, await refreshSession(adminRefreshToken(c), requestInfo(c)));
    } catch (error) {
      // Clear the cookies when the session is over, so the browser stops sending them.
      if (error instanceof AppError && (error.status === 401 || error.status === 403)) {
        clearAdminSession(c);
      }
      throw error;
    }
    return c.body(null, 204);
  })
  .openapi(signOutRoute, async (c) => {
    await signOut(adminRefreshToken(c), requestInfo(c).ipAddress);

    clearAdminSession(c);
    return c.body(null, 204);
  })
  .openapi(session, async (c) => {
    return c.json(await currentAdmin(c.var.admin.adminId), 200);
  });
