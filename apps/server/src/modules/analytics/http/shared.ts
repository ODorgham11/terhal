import type { Context, TypedResponse } from "hono";
import {
  STAFF_COOKIE_AUTH,
  currentStaff,
  requireAnyPermission,
  requirePermission,
  requireStaff,
} from "../../../platform/http/authenticate";
import { problemResponse } from "../../../platform/http/router";
import { createRateLimitKey, rateLimit } from "../../../platform/rate-limit/rate-limit";

const MINUTE = 60 * 1000;

export const security = [{ [STAFF_COOKIE_AUTH]: [] }];

export const signedIn = {
  401: problemResponse("UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in."),
  403: problemResponse("ACCOUNT_NOT_ACTIVE, or FORBIDDEN without the permission."),
};

// Per staff member. The figures and the exports are heavier than a page of a list, so they're counted on their own.
const perStaff = (scope: string, limit: number) =>
  rateLimit({
    limit,
    windowMs: MINUTE,
    key: (c) => createRateLimitKey(scope, "user", currentStaff(c).staffId),
  });

// Everything here needs `analytics`, except the trips CSV, which the trip list offers too (`trips`).
export const analyticsRead = [
  requireStaff,
  requirePermission("analytics"),
  perStaff("staff:analytics:read", 60),
];
export const analyticsWrite = [
  requireStaff,
  requirePermission("analytics"),
  perStaff("staff:analytics:write", 10),
];
export const analyticsExport = [
  requireStaff,
  requirePermission("analytics"),
  perStaff("staff:analytics:export", 10),
];
export const tripsExport = [
  requireStaff,
  requireAnyPermission("analytics", "trips"),
  perStaff("staff:analytics:export", 10),
];

// A CSV download, streamed. The cast is how a non-JSON body fits a typed route (as in the price list's export).
export const csvResponse = (
  c: Context,
  body: ReadableStream<Uint8Array> | string,
  filename: string,
) =>
  c.body(body, 200, {
    "Content-Type": "text/csv; charset=UTF-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  }) as unknown as Response & TypedResponse<string, 200, "text">;
