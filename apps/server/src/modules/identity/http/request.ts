import type { Context } from "hono";
import type { z } from "zod";
import { createRateLimitKey, getClientIp } from "../../../platform/rate-limit/rate-limit";

// Falls back to the connection's address when there's no proxy header (e.g. locally), so sessions always have an IP.
export const requestInfo = (c: Context) => {
  const ip = getClientIp(c);
  return { ipAddress: ip === "unknown" ? null : ip, userAgent: c.req.header("user-agent") ?? null };
};

// Counts requests per value of a JSON body field, normalized by its contract schema first, so writing the same email or
// phone number differently ("01…" and "+201…", say) still counts against one limit. Skips the limit when the field is
// missing or invalid: validation rejects those requests anyway.
export const normalizedBodyKey =
  (scope: string, field: string, schema: z.ZodType<string>) => async (c: Context) => {
    const body: unknown = await c.req.json().catch(() => null);
    const value =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)[field]
        : undefined;
    const parsed = schema.safeParse(value);

    return parsed.success ? createRateLimitKey(scope, "identifier", parsed.data) : undefined;
  };
