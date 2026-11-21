import { createRoute } from "@hono/zod-openapi";
import {
  IdParam,
  ListTeam,
  SetStaffPermissions,
  StaffInvitation,
  StaffInvitationSent,
  TeamMember,
  page,
} from "@terhal/contracts";
import type { Context } from "hono";
import {
  STAFF_COOKIE_AUTH,
  currentStaff,
  requirePermission,
  requireStaff,
} from "../../../platform/http/authenticate";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
import { createRateLimitKey, rateLimit } from "../../../platform/rate-limit/rate-limit";
import {
  listStaffInvitations,
  resendStaffInvitation,
  revokeStaffInvitation,
} from "../application/staff-invitations";
import {
  deleteStaff,
  getTeamMember,
  listTeam,
  reactivateStaff,
  setStaffPermissions,
  suspendStaff,
  type TeamContext,
} from "../application/team";
import { requestInfo } from "./request-info";

// The team page of the dashboard: staff with the team permission managing their colleagues. Admins do the same from the
// admin panel (admin-staff-routes.ts).

const MINUTE = 60 * 1000;

const tags = ["Team"];
const invitationTags = ["Staff invitations"];
const security = [{ [STAFF_COOKIE_AUTH]: [] }];

const perStaff = (scope: string) => (c: Context) =>
  createRateLimitKey(scope, "user", currentStaff(c).staffId);

const team = (scope: string, limit: number, windowMs: number) => [
  requireStaff,
  requirePermission("team"),
  rateLimit({ limit, windowMs, key: perStaff(scope) }),
];

const context = (c: Context): TeamContext => ({
  actor: { staffId: currentStaff(c).staffId },
  ipAddress: requestInfo(c).ipAddress,
});

const signedIn = {
  401: problemResponse("UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in."),
  403: problemResponse("ACCOUNT_NOT_ACTIVE, or FORBIDDEN without the team permission."),
  429: problemResponse("RATE_LIMITED: see the Retry-After header."),
};
const notFound = problemResponse("NOT_FOUND: no staff member with this id.");
const guarded = {
  400: problemResponse("CANNOT_TARGET_SELF (ask a colleague) or VALIDATION_FAILED"),
  404: notFound,
  409: problemResponse(
    "LAST_TEAM_MANAGER: nobody active would hold the team permission. ACCOUNT_DELETED: deleting is final.",
  ),
};

const list = createRoute({
  method: "get",
  path: "/staff/team",
  tags,
  summary: "List the team",
  description: "Oldest first, in one page. Deleted staff only show when asked for by status.",
  middleware: team("staff:team:list", 120, MINUTE),
  security,
  request: { query: ListTeam },
  responses: {
    200: { description: "The team", ...json(page(TeamMember)) },
    400: problemResponse("VALIDATION_FAILED"),
    ...signedIn,
  },
});

const detail = createRoute({
  method: "get",
  path: "/staff/team/{id}",
  tags,
  summary: "A staff member",
  middleware: team("staff:team:detail", 120, MINUTE),
  security,
  request: { params: IdParam },
  responses: {
    200: { description: "The staff member", ...json(TeamMember) },
    ...signedIn,
    404: notFound,
  },
});

const permissions = createRoute({
  method: "put",
  path: "/staff/team/{id}/permissions",
  tags,
  summary: "Set a staff member's permissions",
  description:
    "Replaces them. Any permission can be granted. Not your own, and someone active must keep the team permission. Takes effect on their next request.",
  middleware: team("staff:team:permissions", 60, 15 * MINUTE),
  security,
  request: { params: IdParam, ...body(SetStaffPermissions) },
  responses: { 204: { description: "Permissions set" }, ...signedIn, ...guarded },
});

const suspend = createRoute({
  method: "post",
  path: "/staff/team/{id}/suspend",
  tags,
  summary: "Suspend a staff member",
  description:
    "Signs them out everywhere at once. Not yourself, and not the last active staff member with the team permission. Suspending someone suspended changes nothing.",
  middleware: team("staff:team:suspend", 30, 15 * MINUTE),
  security,
  request: { params: IdParam },
  responses: { 204: { description: "Suspended" }, ...signedIn, ...guarded },
});

const reactivate = createRoute({
  method: "post",
  path: "/staff/team/{id}/reactivate",
  tags,
  summary: "Reactivate a suspended staff member",
  description: "They can sign in again. Reactivating someone active changes nothing.",
  middleware: team("staff:team:reactivate", 30, 15 * MINUTE),
  security,
  request: { params: IdParam },
  responses: { 204: { description: "Reactivated" }, ...signedIn, ...guarded },
});

const remove = createRoute({
  method: "delete",
  path: "/staff/team/{id}",
  tags,
  summary: "Delete a staff member",
  description:
    "Final. Signs them out everywhere; their trips and history stay, and their email can be invited again. Not yourself, and not the last active staff member with the team permission.",
  middleware: team("staff:team:delete", 30, 15 * MINUTE),
  security,
  request: { params: IdParam },
  responses: { 204: { description: "Deleted" }, ...signedIn, ...guarded },
});

const invitations = createRoute({
  method: "get",
  path: "/staff/invitations",
  tags: invitationTags,
  summary: "List open invitations",
  description: "Not accepted or revoked, expired ones included, newest first, in one page.",
  middleware: team("staff:invitations:list", 120, MINUTE),
  security,
  responses: {
    200: { description: "The invitations", ...json(page(StaffInvitation)) },
    ...signedIn,
  },
});

const revokeInvitation = createRoute({
  method: "delete",
  path: "/staff/invitations/{id}",
  tags: invitationTags,
  summary: "Revoke an invitation",
  description: "Its link stops working at once.",
  middleware: team("staff:invitations:revoke", 60, 60 * MINUTE),
  security,
  request: { params: IdParam },
  responses: {
    204: { description: "Revoked" },
    ...signedIn,
    404: problemResponse("NOT_FOUND: unknown, accepted or already revoked."),
  },
});

const resendInvitation = createRoute({
  method: "post",
  path: "/staff/invitations/{id}/resend",
  tags: invitationTags,
  summary: "Email an invitation again",
  description:
    "Sends a new link, valid for 7 more days, even if the invitation had expired. The previous link stops working.",
  middleware: team("staff:invitations:resend", 30, 60 * MINUTE),
  security,
  request: { params: IdParam },
  responses: {
    200: { description: "Sent", ...json(StaffInvitationSent) },
    ...signedIn,
    404: problemResponse("NOT_FOUND: unknown, accepted or already revoked."),
    409: problemResponse("ACCOUNT_ALREADY_EXISTS: the email belongs to a staff member now."),
    503: problemResponse("SERVICE_UNAVAILABLE: the email couldn't be sent. Try again."),
  },
});

export const teamRoutes = createRouter()
  .openapi(list, async (c) => {
    return c.json(await listTeam(c.req.valid("query")), 200);
  })
  .openapi(detail, async (c) => {
    return c.json(await getTeamMember(c.req.valid("param").id), 200);
  })
  .openapi(permissions, async (c) => {
    const { id } = c.req.valid("param");
    await setStaffPermissions(id, c.req.valid("json").permissions, context(c));
    return c.body(null, 204);
  })
  .openapi(suspend, async (c) => {
    await suspendStaff(c.req.valid("param").id, context(c));
    return c.body(null, 204);
  })
  .openapi(reactivate, async (c) => {
    await reactivateStaff(c.req.valid("param").id, context(c));
    return c.body(null, 204);
  })
  .openapi(remove, async (c) => {
    await deleteStaff(c.req.valid("param").id, context(c));
    return c.body(null, 204);
  })
  .openapi(invitations, async (c) => {
    return c.json(await listStaffInvitations(), 200);
  })
  .openapi(revokeInvitation, async (c) => {
    await revokeStaffInvitation(c.req.valid("param").id, context(c));
    return c.body(null, 204);
  })
  .openapi(resendInvitation, async (c) => {
    return c.json(await resendStaffInvitation(c.req.valid("param").id, context(c)), 200);
  });
