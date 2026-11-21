import { createRoute } from "@hono/zod-openapi";
import {
  IdParam,
  ListNotifications,
  ReadAllNotifications,
  StaffNotification,
  UnreadCount,
  page,
} from "@terhal/contracts";
import type { Context } from "hono";
import { STAFF_COOKIE_AUTH, currentStaff, requireStaff } from "../../../platform/http/authenticate";
import { createRouter, json, problemResponse } from "../../../platform/http/router";
import { createRateLimitKey, rateLimit } from "../../../platform/rate-limit/rate-limit";
import { listNotifications, markAllRead, markRead, unreadCount } from "../application/inbox";

// The dashboard's inbox (N6). Any signed in staff member reads their own; only those with `trips` are sent any (N1).

const MINUTE = 60 * 1000;
const tags = ["Staff notifications"];
const security = [{ [STAFF_COOKIE_AUTH]: [] }];

const signedIn = (scope: string, limit: number) => [
  requireStaff,
  rateLimit({
    limit,
    windowMs: MINUTE,
    key: (c: Context) => createRateLimitKey(scope, "user", currentStaff(c).staffId),
  }),
];

const problems = {
  401: problemResponse("UNAUTHENTICATED or ACCESS_TOKEN_EXPIRED: refresh, or sign in."),
  403: problemResponse("ACCOUNT_NOT_ACTIVE"),
  429: problemResponse("RATE_LIMITED: see the Retry-After header."),
};

const list = createRoute({
  method: "get",
  path: "/staff/notifications",
  tags,
  summary: "List your notifications",
  description: "Newest first, in your language. `unread=true` lists only the unread ones.",
  middleware: signedIn("staff:notifications:read", 120),
  security,
  request: { query: ListNotifications },
  responses: {
    200: { description: "One page of notifications", ...json(page(StaffNotification)) },
    400: problemResponse("VALIDATION_FAILED"),
    ...problems,
  },
});

const count = createRoute({
  method: "get",
  path: "/staff/notifications/unread-count",
  tags,
  summary: "Count your unread notifications",
  description: "Cheap enough to poll: the dashboard asks every 30 seconds.",
  middleware: signedIn("staff:notifications:count", 120),
  security,
  responses: {
    200: { description: "How many are unread", ...json(UnreadCount) },
    ...problems,
  },
});

const read = createRoute({
  method: "post",
  path: "/staff/notifications/{id}/read",
  tags,
  summary: "Mark a notification read",
  description: "Reading one already read keeps the time it was first read.",
  middleware: signedIn("staff:notifications:write", 120),
  security,
  request: { params: IdParam },
  responses: {
    200: { description: "The notification", ...json(StaffNotification) },
    ...problems,
    404: problemResponse("NOT_FOUND: no such notification of yours."),
  },
});

const readAll = createRoute({
  method: "post",
  path: "/staff/notifications/read-all",
  tags,
  summary: "Mark every notification read",
  middleware: signedIn("staff:notifications:write", 120),
  security,
  responses: {
    200: { description: "How many were unread", ...json(ReadAllNotifications) },
    ...problems,
  },
});

const staffId = (c: Context) => currentStaff(c).staffId;

export const staffNotificationRoutes = createRouter()
  .openapi(list, async (c) => c.json(await listNotifications(staffId(c), c.req.valid("query")), 200))
  .openapi(count, async (c) => c.json(await unreadCount(staffId(c)), 200))
  .openapi(readAll, async (c) => c.json(await markAllRead(staffId(c)), 200))
  .openapi(read, async (c) => c.json(await markRead(staffId(c), c.req.valid("param").id), 200));
