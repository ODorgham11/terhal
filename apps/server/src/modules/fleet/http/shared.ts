import type { Context } from "hono";
import {
  STAFF_COOKIE_AUTH,
  currentStaff,
  requireAnyPermission,
  requirePermission,
  requireStaff,
} from "../../../platform/http/authenticate";
import { problemResponse } from "../../../platform/http/router";
import { getClientIp } from "../../../platform/rate-limit/rate-limit";

// Who may do what (domains.md, X6): reads need `fleet` or `trips` (booking and assignment pick drivers, vehicles and
// offices), writes need `fleet`.
export const canRead = [requireStaff, requireAnyPermission("fleet", "trips")];
export const canWrite = [requireStaff, requirePermission("fleet")];

export const security = [{ [STAFF_COOKIE_AUTH]: [] }];

// The staff member behind a change, for the audit log.
export const actorOf = (c: Context) => {
  const ip = getClientIp(c);
  return { staffId: currentStaff(c).staffId, ipAddress: ip === "unknown" ? null : ip };
};

// What every staff route can answer besides its own.
export const staffProblems = {
  401: problemResponse("UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in."),
  403: problemResponse("ACCOUNT_NOT_ACTIVE, or FORBIDDEN: missing the permission."),
};
