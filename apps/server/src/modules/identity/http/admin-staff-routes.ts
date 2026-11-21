import { createRoute } from "@hono/zod-openapi";
import {
  AdminInviteStaff,
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
  ADMIN_COOKIE_AUTH,
  currentAdminId,
  requireAdmin,
} from "../../../platform/http/authenticate";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
import { createRateLimitKey, rateLimit } from "../../../platform/rate-limit/rate-limit";
import {
  inviteStaffAsAdmin,
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

// Admins manage the company's staff like a team manager in the dashboard does (team-routes.ts), for support and to
// recover a team that locked itself out. The same guard rails apply, except that an admin is never the target.

const MINUTE = 60 * 1000;

const tags = ["Admin staff"];
const security = [{ [ADMIN_COOKIE_AUTH]: [] }];

const admin = (scope: string, limit: number, windowMs: number) => [
  requireAdmin,
  rateLimit({
    limit,
    windowMs,
    key: (c: Context) => createRateLimitKey(scope, "user", currentAdminId(c)),
  }),
];

const context = (c: Context): TeamContext => ({
  actor: { adminId: currentAdminId(c) },
  ipAddress: requestInfo(c).ipAddress,
});

const signedIn = {
  401: problemResponse("UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in."),
  403: problemResponse("ACCOUNT_NOT_ACTIVE"),
  429: problemResponse("RATE_LIMITED: see the Retry-After header."),
};
const notFound = problemResponse("NOT_FOUND: no staff member with this id.");
const guarded = {
  400: problemResponse("VALIDATION_FAILED"),
  404: notFound,
  409: problemResponse(
    "LAST_TEAM_MANAGER: nobody active would hold the team permission. ACCOUNT_DELETED: deleting is final.",
  ),
};
const invitationGone = problemResponse("NOT_FOUND: unknown, accepted or already revoked.");

// How the company's first staff member gets in: after that, staff with the team permission invite the rest.
const invite = createRoute({
  method: "post",
  path: "/admin/staff/invitations",
  tags,
  summary: "Invite a staff member",
  description:
    "Emails a link to the dashboard that lasts 7 days, with every permission unless told otherwise. Inviting the same email again revokes the earlier links.",
  middleware: admin("admin:staff:invite", 30, 60 * MINUTE),
  security,
  request: body(AdminInviteStaff),
  responses: {
    201: { description: "Invitation sent", ...json(StaffInvitationSent) },
    400: problemResponse("VALIDATION_FAILED"),
    ...signedIn,
    409: problemResponse("ACCOUNT_ALREADY_EXISTS: the email already belongs to a staff member."),
    503: problemResponse("SERVICE_UNAVAILABLE: the email couldn't be sent."),
  },
});

const invitations = createRoute({
  method: "get",
  path: "/admin/staff/invitations",
  tags,
  summary: "List open staff invitations",
  description: "Not accepted or revoked, expired ones included, newest first, in one page.",
  middleware: admin("admin:staff:invitations:list", 120, MINUTE),
  security,
  responses: {
    200: { description: "The invitations", ...json(page(StaffInvitation)) },
    ...signedIn,
  },
});

const revokeInvitation = createRoute({
  method: "delete",
  path: "/admin/staff/invitations/{id}",
  tags,
  summary: "Revoke a staff invitation",
  description: "Its link stops working at once.",
  middleware: admin("admin:staff:invitations:revoke", 60, 60 * MINUTE),
  security,
  request: { params: IdParam },
  responses: { 204: { description: "Revoked" }, ...signedIn, 404: invitationGone },
});

const resendInvitation = createRoute({
  method: "post",
  path: "/admin/staff/invitations/{id}/resend",
  tags,
  summary: "Email a staff invitation again",
  description:
    "Sends a new link, valid for 7 more days, even if the invitation had expired. The previous link stops working.",
  middleware: admin("admin:staff:invitations:resend", 30, 60 * MINUTE),
  security,
  request: { params: IdParam },
  responses: {
    200: { description: "Sent", ...json(StaffInvitationSent) },
    ...signedIn,
    404: invitationGone,
    409: problemResponse("ACCOUNT_ALREADY_EXISTS: the email belongs to a staff member now."),
    503: problemResponse("SERVICE_UNAVAILABLE: the email couldn't be sent. Try again."),
  },
});

const list = createRoute({
  method: "get",
  path: "/admin/staff",
  tags,
  summary: "List staff",
  description: "Oldest first, in one page. Deleted staff only show when asked for by status.",
  middleware: admin("admin:staff:list", 120, MINUTE),
  security,
  request: { query: ListTeam },
  responses: {
    200: { description: "The staff", ...json(page(TeamMember)) },
    400: problemResponse("VALIDATION_FAILED"),
    ...signedIn,
  },
});

const detail = createRoute({
  method: "get",
  path: "/admin/staff/{id}",
  tags,
  summary: "A staff member",
  middleware: admin("admin:staff:detail", 120, MINUTE),
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
  path: "/admin/staff/{id}/permissions",
  tags,
  summary: "Set a staff member's permissions",
  description:
    "Replaces them. Someone active must keep the team permission. Takes effect on their next request.",
  middleware: admin("admin:staff:permissions", 60, 15 * MINUTE),
  security,
  request: { params: IdParam, ...body(SetStaffPermissions) },
  responses: { 204: { description: "Permissions set" }, ...signedIn, ...guarded },
});

const suspend = createRoute({
  method: "post",
  path: "/admin/staff/{id}/suspend",
  tags,
  summary: "Suspend a staff member",
  description:
    "Signs them out everywhere at once. Not the last active staff member with the team permission. Suspending someone suspended changes nothing.",
  middleware: admin("admin:staff:suspend", 30, 15 * MINUTE),
  security,
  request: { params: IdParam },
  responses: { 204: { description: "Suspended" }, ...signedIn, ...guarded },
});

const reactivate = createRoute({
  method: "post",
  path: "/admin/staff/{id}/reactivate",
  tags,
  summary: "Reactivate a suspended staff member",
  description: "They can sign in again. Reactivating someone active changes nothing.",
  middleware: admin("admin:staff:reactivate", 30, 15 * MINUTE),
  security,
  request: { params: IdParam },
  responses: { 204: { description: "Reactivated" }, ...signedIn, ...guarded },
});

const remove = createRoute({
  method: "delete",
  path: "/admin/staff/{id}",
  tags,
  summary: "Delete a staff member",
  description:
    "Final. Signs them out everywhere; their trips and history stay, and their email can be invited again. Not the last active staff member with the team permission.",
  middleware: admin("admin:staff:delete", 30, 15 * MINUTE),
  security,
  request: { params: IdParam },
  responses: { 204: { description: "Deleted" }, ...signedIn, ...guarded },
});

// The invitation routes come first, so /admin/staff/invitations is never read as a staff member's id.
export const adminStaffRoutes = createRouter()
  .openapi(invite, async (c) => {
    const sent = await inviteStaffAsAdmin(
      c.req.valid("json"),
      currentAdminId(c),
      requestInfo(c).ipAddress,
    );
    return c.json(sent, 201);
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
  })
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
  });
