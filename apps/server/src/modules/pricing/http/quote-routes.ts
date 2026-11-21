import { createRoute } from "@hono/zod-openapi";
import { Quote, QuoteRequest } from "@terhal/contracts";
import { requirePermission, requireStaff } from "../../../platform/http/authenticate";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
import { ipKey, rateLimit } from "../../../platform/rate-limit/rate-limit";
import { quote } from "../application/quotes";
import { MINUTE, perStaff, security, signedIn } from "./shared";

const tags = ["Quotes"];

const description =
  "Resolves each pin to the most specific place covering it, then prices every active class with every car body by walking up the location tree. An option without a price has `price: null`: it can be booked on request.";

const failures = {
  400: problemResponse("VALIDATION_FAILED"),
  422: problemResponse(
    "OUT_OF_COVERAGE (`end`: pickup or dropoff, `leg`) or QUOTE_SAME_PLACE (both ends resolve to one place).",
  ),
  429: problemResponse("RATE_LIMITED"),
};

// Public, so limited per IP (X7).
const siteQuote = createRoute({
  method: "post",
  path: "/site/quotes",
  tags,
  summary: "Price a trip",
  description,
  middleware: [rateLimit({ limit: 60, windowMs: MINUTE, key: ipKey("site:quotes") })] as const,
  request: body(QuoteRequest),
  responses: { 200: { description: "The options", ...json(Quote) }, ...failures },
});

const staffQuote = createRoute({
  method: "post",
  path: "/staff/quotes",
  tags,
  summary: "Price a trip",
  description: `${description} Needs \`trips\`.`,
  middleware: [requireStaff, requirePermission("trips"), perStaff("staff:quotes", 120)],
  security,
  request: body(QuoteRequest),
  responses: { 200: { description: "The options", ...json(Quote) }, ...signedIn, ...failures },
});

export const quoteRoutes = createRouter()
  .openapi(siteQuote, async (c) => c.json(await quote(c.req.valid("json")), 200))
  .openapi(staffQuote, async (c) => c.json(await quote(c.req.valid("json")), 200));
