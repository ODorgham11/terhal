import { createRoute } from "@hono/zod-openapi";
import { Email, Guest, GuestStart, GuestVerify } from "@terhal/contracts";
import type { Context } from "hono";
import {
  GUEST_COOKIE_AUTH,
  clearGuestSession,
  currentGuestSessionId,
  guestToken,
  requireGuest,
  setGuestSession,
} from "../../../platform/http/authenticate";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
import { createRateLimitKey, ipKey, rateLimit } from "../../../platform/rate-limit/rate-limit";
import {
  currentGuest,
  resendGuestCode,
  signOutGuest,
  startGuest,
  verifyGuest,
} from "../application/guests";
import { normalizedBodyKey } from "./request";

const MINUTE = 60 * 1000;

const tags = ["Guest"];
const security = [{ [GUEST_COOKIE_AUTH]: [] }];
const rateLimited = problemResponse("RATE_LIMITED: see the Retry-After header.");
const noSession = problemResponse("UNAUTHENTICATED: no live guest session; start again.");

// Limits code guesses and resends per guest session, not just per IP.
const sessionKey = (scope: string) => (c: Context) => {
  const token = guestToken(c);
  return token ? createRateLimitKey(scope, "user", token) : undefined;
};

const start = createRoute({
  method: "post",
  path: "/site/guest",
  tags,
  summary: "Continue as a guest",
  description:
    "Starts a 30-day guest session (the cookie) and emails a 6-digit code to confirm it with /v1/site/guest/verify. Ends any guest session the browser already had.",
  middleware: [
    rateLimit({ limit: 10, windowMs: 60 * MINUTE, key: ipKey("guest:start") }),
    rateLimit({
      limit: 5,
      windowMs: 60 * MINUTE,
      key: normalizedBodyKey("guest:start", "email", Email),
    }),
  ] as const,
  request: body(GuestStart),
  responses: {
    201: {
      description: "Session started; a code is on its way",
      headers: {
        "Set-Cookie": {
          description: "The guest session cookie (httpOnly).",
          schema: { type: "string" as const },
        },
      },
      ...json(Guest),
    },
    400: problemResponse("VALIDATION_FAILED"),
    429: rateLimited,
  },
});

const verify = createRoute({
  method: "post",
  path: "/site/guest/verify",
  tags,
  summary: "Confirm the guest's details with the emailed code",
  description: "A code lasts 10 minutes and takes 5 tries at most. Verifying twice is harmless.",
  middleware: [
    rateLimit({ limit: 20, windowMs: 15 * MINUTE, key: ipKey("guest:verify") }),
    rateLimit({ limit: 10, windowMs: 15 * MINUTE, key: sessionKey("guest:verify") }),
  ] as const,
  request: body(GuestVerify),
  security,
  responses: {
    200: { description: "Verified", ...json(Guest) },
    400: problemResponse(
      "VERIFICATION_CODE_INVALID, VERIFICATION_CODE_EXPIRED (expired or tried too often: ask for a new one) or VALIDATION_FAILED",
    ),
    401: noSession,
    429: rateLimited,
  },
});

const resend = createRoute({
  method: "post",
  path: "/site/guest/verify/resend",
  tags,
  summary: "Email a new code",
  description: "Replaces the previous code. Does nothing once the guest is verified.",
  middleware: [
    rateLimit({ limit: 10, windowMs: 60 * MINUTE, key: ipKey("guest:verify:resend") }),
    rateLimit({ limit: 3, windowMs: 15 * MINUTE, key: sessionKey("guest:verify:resend") }),
  ] as const,
  security,
  responses: {
    202: { description: "A new code is on its way if the guest needs one" },
    401: noSession,
    429: rateLimited,
  },
});

const current = createRoute({
  method: "get",
  path: "/site/guest",
  tags,
  summary: "The verified guest",
  middleware: [requireGuest] as const,
  security,
  responses: {
    200: { description: "The guest", ...json(Guest) },
    401: noSession,
    403: problemResponse("VERIFICATION_REQUIRED: verify the emailed code first."),
  },
});

const signOutRoute = createRoute({
  method: "post",
  path: "/site/guest/sign-out",
  tags,
  summary: "End the guest session",
  description: "Ends the session and clears the cookie. Always succeeds.",
  security,
  responses: { 204: { description: "Signed out" } },
});

export const guestRoutes = createRouter()
  .openapi(start, async (c) => {
    const { token, guest, expiresAt } = await startGuest(c.req.valid("json"), guestToken(c));

    setGuestSession(c, token, expiresAt);
    return c.json(guest, 201);
  })
  .openapi(verify, async (c) => {
    return c.json(await verifyGuest(guestToken(c), c.req.valid("json").code), 200);
  })
  .openapi(resend, async (c) => {
    await resendGuestCode(guestToken(c));
    return c.body(null, 202);
  })
  .openapi(current, async (c) => {
    return c.json(await currentGuest(currentGuestSessionId(c)), 200);
  })
  .openapi(signOutRoute, async (c) => {
    await signOutGuest(guestToken(c));

    clearGuestSession(c);
    return c.body(null, 204);
  });
