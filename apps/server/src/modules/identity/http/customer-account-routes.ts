import { createRoute } from "@hono/zod-openapi";
import {
  AccountSession,
  ChangeCustomerEmail,
  ChangeCustomerPhone,
  ChangePassword,
  ConfirmContactChange,
  ContactChangeSent,
  Customer,
  IdParam,
  UpdateCustomerAccount,
  page,
} from "@terhal/contracts";
import type { Context } from "hono";
import {
  CUSTOMER_COOKIE_AUTH,
  clearSession,
  currentCustomerId,
  requireCustomer,
  type CustomerActor,
} from "../../../platform/http/authenticate";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
import { createRateLimitKey, rateLimit } from "../../../platform/rate-limit/rate-limit";
import {
  changeCustomerPassword,
  confirmContactChange,
  requestContactChange,
  updateCustomerAccount,
} from "../application/customer-account";
import {
  listCustomerSessions,
  revokeCustomerSessions,
  revokeOwnCustomerSession,
} from "../application/customer-sessions";
import { currentCustomer } from "../application/customers";

// A signed in customer's own account on the customer site: their details, email, phone, password and sessions.

const MINUTE = 60 * 1000;

const tags = ["Customer account"];
const security = [{ [CUSTOMER_COOKIE_AUTH]: [] }];

const actor = (c: Context) => c.get("customer") as CustomerActor;

const signedIn = (scope: string, limit: number, windowMs: number) => [
  requireCustomer,
  rateLimit({
    limit,
    windowMs,
    key: (c: Context) => createRateLimitKey(scope, "user", currentCustomerId(c)),
  }),
];

const signedInErrors = {
  401: problemResponse("UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in."),
  403: problemResponse("ACCOUNT_NOT_ACTIVE"),
  429: problemResponse("RATE_LIMITED: see the Retry-After header."),
};
const wrongPassword = problemResponse(
  "INVALID_CREDENTIALS: the current password is wrong. UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in.",
);
const codeErrors = problemResponse(
  "VERIFICATION_CODE_INVALID (also when nothing is waiting to be confirmed), VERIFICATION_CODE_EXPIRED (expired or tried too often: ask again) or VALIDATION_FAILED",
);

const account = createRoute({
  method: "get",
  path: "/site/account",
  tags,
  summary: "Your account",
  middleware: signedIn("customer:account:get", 120, MINUTE),
  security,
  responses: { 200: { description: "Your account", ...json(Customer) }, ...signedInErrors },
});

const updateAccount = createRoute({
  method: "patch",
  path: "/site/account",
  tags,
  summary: "Change your name or language",
  description: "Only the fields sent change. Emails go out in `locale`.",
  middleware: signedIn("customer:account:update", 30, 15 * MINUTE),
  security,
  request: body(UpdateCustomerAccount),
  responses: {
    200: { description: "Your account", ...json(Customer) },
    400: problemResponse("VALIDATION_FAILED"),
    ...signedInErrors,
  },
});

const changeEmail = createRoute({
  method: "post",
  path: "/site/account/email",
  tags,
  summary: "Start changing your email",
  description:
    "Takes your password and emails a 6-digit code to the new address. The email changes only once the code is confirmed with /v1/site/account/email/confirm. Asking again, or for a phone change, replaces this request.",
  middleware: signedIn("customer:account:email", 5, 15 * MINUTE),
  security,
  request: body(ChangeCustomerEmail),
  responses: {
    202: { description: "A code is on its way", ...json(ContactChangeSent) },
    400: problemResponse("BAD_REQUEST (that's already your email) or VALIDATION_FAILED"),
    ...signedInErrors,
    401: wrongPassword,
    409: problemResponse("ACCOUNT_ALREADY_EXISTS: another account uses this email."),
  },
});

const confirmEmail = createRoute({
  method: "post",
  path: "/site/account/email/confirm",
  tags,
  summary: "Confirm your new email",
  description: "A code lasts 10 minutes and takes 5 tries at most.",
  middleware: signedIn("customer:account:email:confirm", 10, 15 * MINUTE),
  security,
  request: body(ConfirmContactChange),
  responses: {
    200: { description: "Email changed", ...json(Customer) },
    400: codeErrors,
    ...signedInErrors,
    409: problemResponse("ACCOUNT_ALREADY_EXISTS: another account took this email meanwhile."),
  },
});

const changePhone = createRoute({
  method: "post",
  path: "/site/account/phone",
  tags,
  summary: "Start changing your phone number",
  description:
    "Takes your password and emails a 6-digit code to your current email. The phone changes only once the code is confirmed with /v1/site/account/phone/confirm. Asking again, or for an email change, replaces this request.",
  middleware: signedIn("customer:account:phone", 5, 15 * MINUTE),
  security,
  request: body(ChangeCustomerPhone),
  responses: {
    202: { description: "A code is on its way", ...json(ContactChangeSent) },
    400: problemResponse("BAD_REQUEST (that's already your phone number) or VALIDATION_FAILED"),
    ...signedInErrors,
    401: wrongPassword,
    409: problemResponse("ACCOUNT_ALREADY_EXISTS: another account uses this phone number."),
  },
});

const confirmPhone = createRoute({
  method: "post",
  path: "/site/account/phone/confirm",
  tags,
  summary: "Confirm your new phone number",
  description: "A code lasts 10 minutes and takes 5 tries at most.",
  middleware: signedIn("customer:account:phone:confirm", 10, 15 * MINUTE),
  security,
  request: body(ConfirmContactChange),
  responses: {
    200: { description: "Phone number changed", ...json(Customer) },
    400: codeErrors,
    ...signedInErrors,
    409: problemResponse(
      "ACCOUNT_ALREADY_EXISTS: another account took this phone number meanwhile.",
    ),
  },
});

const changePassword = createRoute({
  method: "post",
  path: "/site/account/password",
  tags,
  summary: "Change your password",
  description: "Takes the current password. Signs you out everywhere else; this session stays.",
  middleware: signedIn("customer:account:password", 5, 15 * MINUTE),
  security,
  request: body(ChangePassword),
  responses: {
    204: { description: "Password changed" },
    400: problemResponse("VALIDATION_FAILED"),
    ...signedInErrors,
    401: wrongPassword,
  },
});

const sessions = createRoute({
  method: "get",
  path: "/site/account/sessions",
  tags,
  summary: "List your sessions",
  description: "Your active sessions, newest first, in one page. `current` marks this one.",
  middleware: signedIn("customer:sessions:list", 120, MINUTE),
  security,
  responses: {
    200: { description: "Your active sessions", ...json(page(AccountSession)) },
    ...signedInErrors,
  },
});

const revokeSession = createRoute({
  method: "delete",
  path: "/site/account/sessions/{id}",
  tags,
  summary: "End one of your sessions",
  description: "Ending the current session also clears its cookies, like signing out.",
  middleware: signedIn("customer:sessions:revoke", 60, 15 * MINUTE),
  security,
  request: { params: IdParam },
  responses: {
    204: { description: "Session ended" },
    ...signedInErrors,
    404: problemResponse("NOT_FOUND: no such active session of yours."),
  },
});

const revokeOthers = createRoute({
  method: "post",
  path: "/site/account/sessions/all/revoke",
  tags,
  summary: "Sign out everywhere else",
  description: "Ends every session of yours except this one.",
  middleware: signedIn("customer:sessions:revoke-all", 20, 15 * MINUTE),
  security,
  responses: { 204: { description: "Every other session ended" }, ...signedInErrors },
});

export const customerAccountRoutes = createRouter()
  .openapi(account, async (c) => {
    return c.json(await currentCustomer(currentCustomerId(c)), 200);
  })
  .openapi(updateAccount, async (c) => {
    return c.json(await updateCustomerAccount(currentCustomerId(c), c.req.valid("json")), 200);
  })
  .openapi(changeEmail, async (c) => {
    return c.json(await requestContactChange(currentCustomerId(c), c.req.valid("json")), 202);
  })
  .openapi(confirmEmail, async (c) => {
    const { code } = c.req.valid("json");
    return c.json(await confirmContactChange(currentCustomerId(c), "email", code), 200);
  })
  .openapi(changePhone, async (c) => {
    return c.json(await requestContactChange(currentCustomerId(c), c.req.valid("json")), 202);
  })
  .openapi(confirmPhone, async (c) => {
    const { code } = c.req.valid("json");
    return c.json(await confirmContactChange(currentCustomerId(c), "phone", code), 200);
  })
  .openapi(changePassword, async (c) => {
    await changeCustomerPassword(c.req.valid("json"), actor(c));
    return c.body(null, 204);
  })
  .openapi(sessions, async (c) => {
    const { customerId, sessionId } = actor(c);
    return c.json(await listCustomerSessions(customerId, sessionId), 200);
  })
  .openapi(revokeSession, async (c) => {
    const { id } = c.req.valid("param");
    const { customerId, sessionId } = actor(c);
    await revokeOwnCustomerSession(customerId, id);

    // Ending the session making the request is signing out, so the browser stops sending its cookies.
    if (id === sessionId) clearSession(c, "customer");
    return c.body(null, 204);
  })
  .openapi(revokeOthers, async (c) => {
    const { customerId, sessionId } = actor(c);
    await revokeCustomerSessions(customerId, undefined, sessionId);
    return c.body(null, 204);
  });
