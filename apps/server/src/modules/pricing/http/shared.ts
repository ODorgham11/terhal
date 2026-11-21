import type { Context } from "hono";
import { z } from "zod";
import type { AuditActor } from "../../audit/index";
import { STAFF_COOKIE_AUTH, currentStaff } from "../../../platform/http/authenticate";
import { problemResponse } from "../../../platform/http/router";
import {
  createRateLimitKey,
  getClientIp,
  rateLimit,
} from "../../../platform/rate-limit/rate-limit";

export const MINUTE = 60 * 1000;

export const security = [{ [STAFF_COOKIE_AUTH]: [] }];

export const IdParam = z.object({ id: z.string().min(1, "Id is required.") });

export const signedIn = {
  401: problemResponse("UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in."),
  403: problemResponse("ACCOUNT_NOT_ACTIVE, or FORBIDDEN without the permission."),
};

// The staff member behind a change, for the audit log.
export const staffActor = (c: Context): AuditActor => {
  const ip = getClientIp(c);
  return { staffId: currentStaff(c).staffId, ipAddress: ip === "unknown" ? null : ip };
};

// Per staff member, generous enough for a busy editor.
export const perStaff = (scope: string, limit = 60) =>
  rateLimit({
    limit,
    windowMs: MINUTE,
    key: (c) => createRateLimitKey(scope, "user", currentStaff(c).staffId),
  });
