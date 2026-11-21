import { createRoute } from "@hono/zod-openapi";
import {
  AdminInvitation,
  AdminInvitationSent,
  IdParam,
  InviteAdmin,
  page,
} from "@terhal/contracts";
import type { Context } from "hono";
import {
  ADMIN_COOKIE_AUTH,
  currentAdminId,
  requireAdmin,
} from "../../../platform/http/authenticate";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
import { createRateLimitKey, rateLimit } from "../../../platform/rate-limit/rate-limit";
import { inviteAdmin, listInvitations, revokeInvitation } from "../application/admin-invitations";
import { requestInfo } from "./request-info";

const MINUTE = 60 * 1000;

const tags = ["Admin invitations"];
const security = [{ [ADMIN_COOKIE_AUTH]: [] }];
const perAdmin = (scope: string) => (c: Context) =>
  createRateLimitKey(scope, "user", currentAdminId(c));

const signedIn = {
  401: problemResponse("UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in."),
  403: problemResponse("ACCOUNT_NOT_ACTIVE"),
  429: problemResponse("RATE_LIMITED: see the Retry-After header."),
};

// Every admin after the first is invited by another, who confirms it with a current authenticator code. The invitee
// accepts through /v1/admin/invitations/lookup, /totp and /accept, like the first admin.
const invite = createRoute({
  method: "post",
  path: "/admin/invitations",
  tags,
  summary: "Invite an admin",
  description:
    "Emails a link to the admin panel that lasts 48 hours. Inviting the same email again revokes its earlier links.",
  middleware: [
    requireAdmin,
    rateLimit({ limit: 20, windowMs: 60 * MINUTE, key: perAdmin("admin:invitations:create") }),
  ] as const,
  security,
  request: body(InviteAdmin),
  responses: {
    201: { description: "Invitation sent", ...json(AdminInvitationSent) },
    400: problemResponse("TOTP_CODE_INVALID or VALIDATION_FAILED"),
    ...signedIn,
    403: problemResponse("ACCOUNT_NOT_ACTIVE or TOTP_SETUP_REQUIRED"),
    409: problemResponse("ACCOUNT_ALREADY_EXISTS: the email already belongs to an admin."),
    503: problemResponse("SERVICE_UNAVAILABLE: the email couldn't be sent."),
  },
});

const list = createRoute({
  method: "get",
  path: "/admin/invitations",
  tags,
  summary: "List pending invitations",
  description: "The invitations not yet accepted, revoked or expired, newest first, in one page.",
  middleware: [
    requireAdmin,
    rateLimit({ limit: 120, windowMs: MINUTE, key: perAdmin("admin:invitations:list") }),
  ] as const,
  security,
  responses: {
    200: { description: "The pending invitations", ...json(page(AdminInvitation)) },
    ...signedIn,
  },
});

const revoke = createRoute({
  method: "delete",
  path: "/admin/invitations/{id}",
  tags,
  summary: "Revoke a pending invitation",
  description: "Its link stops working at once.",
  middleware: [
    requireAdmin,
    rateLimit({ limit: 60, windowMs: 60 * MINUTE, key: perAdmin("admin:invitations:revoke") }),
  ] as const,
  security,
  request: { params: IdParam },
  responses: {
    204: { description: "Revoked" },
    ...signedIn,
    404: problemResponse("NOT_FOUND: unknown, or no longer pending."),
  },
});

export const adminInvitationRoutes = createRouter()
  .openapi(invite, async (c) => {
    const sent = await inviteAdmin(
      c.req.valid("json"),
      currentAdminId(c),
      requestInfo(c).ipAddress,
    );
    return c.json(sent, 201);
  })
  .openapi(list, async (c) => {
    return c.json(await listInvitations(), 200);
  })
  .openapi(revoke, async (c) => {
    await revokeInvitation(c.req.valid("param").id, currentAdminId(c), requestInfo(c).ipAddress);
    return c.body(null, 204);
  });
