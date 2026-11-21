import type { Context } from "hono";
import { z } from "zod";
import {
  CUSTOMER_COOKIE_AUTH,
  GUEST_COOKIE_AUTH,
  STAFF_COOKIE_AUTH,
  currentBooker,
  currentStaff,
  requireBooker,
  requirePermission,
  requireStaff,
} from "../../../platform/http/authenticate";
import { problemResponse } from "../../../platform/http/router";
import {
  createRateLimitKey,
  getClientIp,
  rateLimit,
} from "../../../platform/rate-limit/rate-limit";

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;

export const IdParam = z.object({ id: z.string().min(1, "Id is required.") });

export const tags = ["Trips"];

// --- The dashboard: every trip route needs `trips` ---

export const staffSecurity = [{ [STAFF_COOKIE_AUTH]: [] }];

// Per staff member, generous enough for a busy dispatcher.
const perStaff = (scope: string, limit: number) =>
  rateLimit({
    limit,
    windowMs: MINUTE,
    key: (c) => createRateLimitKey(scope, "user", currentStaff(c).staffId),
  });

export const staffRead = [
  requireStaff,
  requirePermission("trips"),
  perStaff("staff:trips:read", 240),
];
export const staffWrite = [
  requireStaff,
  requirePermission("trips"),
  perStaff("staff:trips:write", 120),
];

export const staffId = (c: Context) => currentStaff(c).staffId;

// The staff member behind a change, for the audit log (a price saved to the price list).
export const staffActor = (c: Context) => {
  const ip = getClientIp(c);
  return { staffId: staffId(c), ipAddress: ip === "unknown" ? null : ip };
};

export const staffProblems = {
  401: problemResponse("UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in."),
  403: problemResponse("ACCOUNT_NOT_ACTIVE, or FORBIDDEN without `trips`."),
  429: problemResponse("RATE_LIMITED"),
};

// --- The customer site: a signed in customer or a verified guest ---

export const siteSecurity: Record<string, string[]>[] = [
  { [CUSTOMER_COOKIE_AUTH]: [] },
  { [GUEST_COOKIE_AUTH]: [] },
];

// Per booker (customer or guest session), and per IP for booking (X7).
const perBooker = (scope: string, limit: number, windowMs: number) =>
  rateLimit({
    limit,
    windowMs,
    key: (c) => {
      const booker = currentBooker(c);
      return "customerId" in booker
        ? createRateLimitKey(scope, "user", `customer:${booker.customerId}`)
        : createRateLimitKey(scope, "user", `guest:${booker.guestSessionId}`);
    },
  });

export const siteRead = [requireBooker, perBooker("site:trips:read", 120, MINUTE)];
export const siteWrite = [requireBooker, perBooker("site:trips:write", 30, MINUTE)];

export const booker = currentBooker;

export const siteProblems = {
  401: problemResponse("UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in."),
  403: problemResponse(
    "ACCOUNT_NOT_ACTIVE (a customer), or VERIFICATION_REQUIRED (a guest who hasn't confirmed their code).",
  ),
  429: problemResponse("RATE_LIMITED"),
};

export const notFound = problemResponse("NOT_FOUND: no such trip (or not one of yours).");
export const invalid = problemResponse("VALIDATION_FAILED");
