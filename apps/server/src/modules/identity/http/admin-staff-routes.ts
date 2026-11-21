import { createRoute } from "@hono/zod-openapi";
import { AdminInviteStaff, StaffInvitationSent } from "@terhal/contracts";
import {
  ADMIN_COOKIE_AUTH,
  currentAdminId,
  requireAdmin,
} from "../../../platform/http/authenticate";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
import { createRateLimitKey, rateLimit } from "../../../platform/rate-limit/rate-limit";
import { inviteStaffAsAdmin } from "../application/staff-invitations";
import { requestInfo } from "./request-info";

const MINUTE = 60 * 1000;

// How the company's first staff member gets in: after that, staff with the team permission invite the rest.
const inviteStaff = createRoute({
  method: "post",
  path: "/admin/staff/invitations",
  tags: ["Admin staff"],
  summary: "Invite a staff member",
  description:
    "Emails a link to the dashboard that lasts 7 days, with every permission unless told otherwise. Inviting the same email again revokes the earlier links.",
  middleware: [
    requireAdmin,
    rateLimit({
      limit: 30,
      windowMs: 60 * MINUTE,
      key: (c) => createRateLimitKey("admin:staff:invite", "user", currentAdminId(c)),
    }),
  ] as const,
  security: [{ [ADMIN_COOKIE_AUTH]: [] }],
  request: body(AdminInviteStaff),
  responses: {
    201: { description: "Invitation sent", ...json(StaffInvitationSent) },
    400: problemResponse("VALIDATION_FAILED"),
    401: problemResponse("UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in."),
    403: problemResponse("ACCOUNT_NOT_ACTIVE"),
    409: problemResponse("ACCOUNT_ALREADY_EXISTS: the email already belongs to a staff member."),
    429: problemResponse("RATE_LIMITED: see the Retry-After header."),
    503: problemResponse("SERVICE_UNAVAILABLE: the email couldn't be sent."),
  },
});

export const adminStaffRoutes = createRouter().openapi(inviteStaff, async (c) => {
  const sent = await inviteStaffAsAdmin(
    c.req.valid("json"),
    currentAdminId(c),
    requestInfo(c).ipAddress,
  );
  return c.json(sent, 201);
});
