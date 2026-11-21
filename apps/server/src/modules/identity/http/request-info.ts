import type { Context } from "hono";
import { getClientIp } from "../../../platform/rate-limit/rate-limit";

// Falls back to the connection's address when there's no proxy header (e.g. locally), so records always have an IP.
export const requestInfo = (c: Context) => {
  const ip = getClientIp(c);
  return { ipAddress: ip === "unknown" ? null : ip, userAgent: c.req.header("user-agent") ?? null };
};
