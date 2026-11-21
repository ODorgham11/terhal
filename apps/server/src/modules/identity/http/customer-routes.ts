import { createRoute } from "@hono/zod-openapi";
import {
  Customer,
  CustomerEmail,
  CustomerIdentifier,
  CustomerPasswordReset,
  CustomerSignIn,
  CustomerSignUp,
  CustomerVerify,
  Email,
} from "@terhal/contracts";
import { AppError } from "../../../platform/errors/app-error";
import {
  CUSTOMER_COOKIE_AUTH,
  clearSession,
  currentCustomerId,
  refreshTokenOf,
  requireCustomer,
  setSession,
} from "../../../platform/http/authenticate";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
import { ipKey, rateLimit } from "../../../platform/rate-limit/rate-limit";
import {
  completePasswordReset,
  requestPasswordReset,
} from "../application/customer-password-reset";
import {
  createCustomerSession,
  refreshCustomerSession,
  signOutCustomer,
} from "../application/customer-sessions";
import { signInCustomer } from "../application/customer-sign-in";
import { resendCustomerCode, signUp, verifyCustomer } from "../application/customer-sign-up";
import { currentCustomer } from "../application/customers";
import { normalizedBodyKey, requestInfo } from "./request";

const MINUTE = 60 * 1000;

const tags = ["Customer auth"];
const security = [{ [CUSTOMER_COOKIE_AUTH]: [] }];
const sessionCookies = {
  "Set-Cookie": {
    description: "The access and refresh cookies (httpOnly; the web app never reads them).",
    schema: { type: "string" as const },
  },
};
const rateLimited = problemResponse("RATE_LIMITED: see the Retry-After header.");
const emailKey = (scope: string) => normalizedBodyKey(scope, "email", Email);

const signUpRoute = createRoute({
  method: "post",
  path: "/site/auth/sign-up",
  tags,
  summary: "Create a customer account",
  description:
    "Creates an unverified account and emails a 6-digit code to confirm it with /v1/site/auth/verify. No session yet.",
  middleware: [
    rateLimit({ limit: 10, windowMs: 60 * MINUTE, key: ipKey("customer:sign-up") }),
  ] as const,
  request: body(CustomerSignUp),
  responses: {
    201: { description: "Account created; a code is on its way", ...json(Customer) },
    400: problemResponse("VALIDATION_FAILED"),
    409: problemResponse("ACCOUNT_ALREADY_EXISTS: the email or the phone number is taken."),
    429: rateLimited,
  },
});

const verify = createRoute({
  method: "post",
  path: "/site/auth/verify",
  tags,
  summary: "Confirm the account with the emailed code",
  description:
    "Activates the account and signs the customer in. A code lasts 10 minutes and takes 5 tries at most.",
  middleware: [
    rateLimit({ limit: 20, windowMs: 15 * MINUTE, key: ipKey("customer:verify") }),
    rateLimit({ limit: 10, windowMs: 15 * MINUTE, key: emailKey("customer:verify") }),
  ] as const,
  request: body(CustomerVerify),
  responses: {
    200: { description: "Verified and signed in", headers: sessionCookies, ...json(Customer) },
    400: problemResponse(
      "VERIFICATION_CODE_INVALID, VERIFICATION_CODE_EXPIRED (expired or tried too often: ask for a new one) or VALIDATION_FAILED",
    ),
    429: rateLimited,
  },
});

const resend = createRoute({
  method: "post",
  path: "/site/auth/verify/resend",
  tags,
  summary: "Email a new code",
  description:
    "Replaces the previous code. Answers the same whether or not the email has an unverified account.",
  middleware: [
    rateLimit({ limit: 10, windowMs: 60 * MINUTE, key: ipKey("customer:verify:resend") }),
    rateLimit({ limit: 3, windowMs: 15 * MINUTE, key: emailKey("customer:verify:resend") }),
  ] as const,
  request: body(CustomerEmail),
  responses: {
    202: { description: "A new code is on its way if the account needs one" },
    400: problemResponse("VALIDATION_FAILED"),
    429: rateLimited,
  },
});

const signIn = createRoute({
  method: "post",
  path: "/site/auth/sign-in",
  tags,
  summary: "Sign in with an email or phone number and a password",
  description:
    "Sets the session cookies. An unverified account gets a fresh code and VERIFICATION_REQUIRED.",
  middleware: [
    rateLimit({ limit: 10, windowMs: 15 * MINUTE, key: ipKey("customer:sign-in") }),
    rateLimit({
      limit: 5,
      windowMs: 15 * MINUTE,
      key: normalizedBodyKey("customer:sign-in", "identifier", CustomerIdentifier),
    }),
  ] as const,
  request: body(CustomerSignIn),
  responses: {
    200: { description: "Signed in", headers: sessionCookies, ...json(Customer) },
    400: problemResponse("VALIDATION_FAILED"),
    401: problemResponse(
      "INVALID_CREDENTIALS: the same for an unknown account and a wrong password.",
    ),
    403: problemResponse(
      "VERIFICATION_REQUIRED (a new code was emailed: continue with /v1/site/auth/verify) or ACCOUNT_NOT_ACTIVE",
    ),
    429: rateLimited,
  },
});

const refresh = createRoute({
  method: "post",
  path: "/site/auth/refresh",
  tags,
  summary: "Renew the session cookies",
  description: "Uses the refresh cookie and rotates it. Send one refresh at a time.",
  middleware: [
    rateLimit({ limit: 60, windowMs: 15 * MINUTE, key: ipKey("customer:refresh") }),
  ] as const,
  security,
  responses: {
    204: { description: "New cookies set", headers: sessionCookies },
    401: problemResponse("INVALID_REFRESH_TOKEN: sign in again."),
    403: problemResponse("ACCOUNT_NOT_ACTIVE"),
    429: rateLimited,
  },
});

const signOutRoute = createRoute({
  method: "post",
  path: "/site/auth/sign-out",
  tags,
  summary: "Sign out",
  description:
    "Ends the session the refresh cookie belongs to and clears the cookies. Always succeeds.",
  security,
  responses: { 204: { description: "Signed out" } },
});

const session = createRoute({
  method: "get",
  path: "/site/auth/session",
  tags,
  summary: "The signed in customer",
  middleware: [requireCustomer] as const,
  security,
  responses: {
    200: { description: "The customer", ...json(Customer) },
    401: problemResponse("UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in."),
    403: problemResponse("ACCOUNT_NOT_ACTIVE"),
  },
});

const requestReset = createRoute({
  method: "post",
  path: "/site/auth/password-reset/request",
  tags,
  summary: "Email a password reset link",
  description:
    "The link works once, for 1 hour. Answers the same whether or not the email has an account.",
  middleware: [
    rateLimit({ limit: 10, windowMs: 60 * MINUTE, key: ipKey("customer:password-reset") }),
    rateLimit({ limit: 3, windowMs: 60 * MINUTE, key: emailKey("customer:password-reset") }),
  ] as const,
  request: body(CustomerEmail),
  responses: {
    202: { description: "A link is on its way if the email has an account" },
    400: problemResponse("VALIDATION_FAILED"),
    429: rateLimited,
  },
});

const completeReset = createRoute({
  method: "post",
  path: "/site/auth/password-reset/complete",
  tags,
  summary: "Set a new password from a reset link",
  description: "Signs the customer out everywhere. They then sign in with the new password.",
  middleware: [
    rateLimit({
      limit: 10,
      windowMs: 15 * MINUTE,
      key: ipKey("customer:password-reset:complete"),
    }),
  ] as const,
  request: body(CustomerPasswordReset),
  responses: {
    204: { description: "Password changed" },
    400: problemResponse("PASSWORD_RESET_INVALID, PASSWORD_RESET_EXPIRED or VALIDATION_FAILED"),
    403: problemResponse("ACCOUNT_NOT_ACTIVE"),
    429: rateLimited,
  },
});

export const customerAuthRoutes = createRouter()
  .openapi(signUpRoute, async (c) => {
    return c.json(await signUp(c.req.valid("json")), 201);
  })
  .openapi(verify, async (c) => {
    const { email, code } = c.req.valid("json");
    const verified = await verifyCustomer(email, code);
    const { customer, session } = await createCustomerSession(verified, requestInfo(c));

    setSession(c, "customer", session);
    return c.json(customer, 200);
  })
  .openapi(resend, async (c) => {
    await resendCustomerCode(c.req.valid("json").email);
    return c.body(null, 202);
  })
  .openapi(signIn, async (c) => {
    const { identifier, password } = c.req.valid("json");
    const signedIn = await signInCustomer(identifier, password);
    const { customer, session } = await createCustomerSession(signedIn, requestInfo(c));

    setSession(c, "customer", session);
    return c.json(customer, 200);
  })
  .openapi(refresh, async (c) => {
    try {
      setSession(
        c,
        "customer",
        await refreshCustomerSession(refreshTokenOf(c, "customer"), requestInfo(c)),
      );
    } catch (error) {
      // Clear the cookies when the session is over, so the browser stops sending them.
      if (error instanceof AppError && (error.status === 401 || error.status === 403)) {
        clearSession(c, "customer");
      }
      throw error;
    }
    return c.body(null, 204);
  })
  .openapi(signOutRoute, async (c) => {
    await signOutCustomer(refreshTokenOf(c, "customer"));

    clearSession(c, "customer");
    return c.body(null, 204);
  })
  .openapi(session, async (c) => {
    return c.json(await currentCustomer(currentCustomerId(c)), 200);
  })
  .openapi(requestReset, async (c) => {
    await requestPasswordReset(c.req.valid("json").email);
    return c.body(null, 202);
  })
  .openapi(completeReset, async (c) => {
    const { token, password } = c.req.valid("json");
    await completePasswordReset(token, password);
    return c.body(null, 204);
  });
