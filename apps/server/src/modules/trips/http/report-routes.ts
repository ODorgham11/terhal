import { createRoute } from "@hono/zod-openapi";
import {
  DriverTrip,
  ReportLink,
  ReportLinkQuery,
  ReportTokenHeader,
  SubmitReport,
  TripReport,
} from "@terhal/contracts";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
import { ipKey, rateLimit } from "../../../platform/rate-limit/rate-limit";
import {
  driverEnd,
  driverStart,
  driverSubmit,
  driverTrip,
  getReport,
  putReport,
  regenerateReportLink,
} from "../application/report";
import { readReportLink } from "../application/report-link";
import {
  IdParam,
  MINUTE,
  invalid,
  notFound,
  staffId,
  staffProblems,
  staffRead,
  staffSecurity,
  staffWrite,
} from "./shared";

// The driver report (docs/domains.md, D): the driver's routes, authenticated by the token in the trip's report link,
// and the dashboard's routes for the link and the report.

const tags = ["Driver report"];

// --- The driver, through the link ---

// No account behind these, so they're limited per IP (X7). The token is 256 bits, so this is about load, not guessing.
const driverRead = [rateLimit({ limit: 60, windowMs: MINUTE, key: ipKey("site:report:read") })];
const driverWrite = [rateLimit({ limit: 20, windowMs: MINUTE, key: ipKey("site:report:write") })];

const driverProblems = {
  401: problemResponse(
    "REPORT_LINK_INVALID (no such link, or it was replaced), or REPORT_LINK_EXPIRED (7 days after pickup).",
  ),
  429: problemResponse("RATE_LIMITED"),
};

const driverGet = createRoute({
  method: "get",
  path: "/site/driver/report",
  tags,
  summary: "Open a trip's report link",
  description:
    "For the driver, with the token from the link's fragment in `Report-Token`. The trip as the driver needs it, when it was started and ended (to prefill the report), and the report once submitted.",
  middleware: driverRead,
  request: { headers: ReportTokenHeader },
  responses: {
    200: { description: "The trip", ...json(DriverTrip) },
    400: invalid,
    ...driverProblems,
  },
});

const driverAction = (path: "start" | "end", summary: string, description: string) =>
  createRoute({
    method: "post",
    path: `/site/driver/report/${path}`,
    tags,
    summary,
    description,
    middleware: driverWrite,
    request: { headers: ReportTokenHeader },
    responses: {
      200: { description: "The trip", ...json(DriverTrip) },
      400: invalid,
      ...driverProblems,
      409: problemResponse(
        path === "start"
          ? "TRIP_STATUS_CONFLICT (`tripStatus`), ASSIGNMENT_REQUIRED, or ASSIGNEE_BUSY (`field`)."
          : "TRIP_STATUS_CONFLICT (`tripStatus`).",
      ),
    },
  });

const driverStartRoute = driverAction(
  "start",
  "Start the trip",
  "Confirmed to in progress, by the driver. The event names the driver.",
);
const driverEndRoute = driverAction(
  "end",
  "End the trip",
  "In progress to awaiting the report, by the driver.",
);

const driverSubmitRoute = createRoute({
  method: "put",
  path: "/site/driver/report",
  tags,
  summary: "Submit the report",
  description: [
    "The whole report, every field required; drafts stay in the browser. Once submitted it's locked for the driver (`REPORT_ALREADY_SUBMITTED`); staff can still correct it until the trip is completed.",
    "A trip still in progress is ended by it. Office fees can't be entered by the driver. Cash collected on an unpaid trip records it as paid in cash to the driver.",
  ].join("\n\n"),
  middleware: driverWrite,
  request: { headers: ReportTokenHeader, ...body(SubmitReport) },
  responses: {
    200: { description: "The trip, with its report", ...json(DriverTrip) },
    400: invalid,
    ...driverProblems,
    409: problemResponse("REPORT_ALREADY_SUBMITTED, or TRIP_STATUS_CONFLICT (`tripStatus`)."),
  },
});

export const driverReportRoutes = createRouter()
  .openapi(driverGet, async (c) =>
    c.json(await driverTrip(c.req.valid("header")["report-token"]), 200),
  )
  .openapi(driverStartRoute, async (c) =>
    c.json(await driverStart(c.req.valid("header")["report-token"]), 200),
  )
  .openapi(driverEndRoute, async (c) =>
    c.json(await driverEnd(c.req.valid("header")["report-token"]), 200),
  )
  .openapi(driverSubmitRoute, async (c) =>
    c.json(await driverSubmit(c.req.valid("header")["report-token"], c.req.valid("json")), 200),
  );

// --- The dashboard ---

const linkGet = createRoute({
  method: "get",
  path: "/staff/trips/{id}/report-link",
  tags,
  summary: "Get the report link",
  description:
    "The driver's report link, to copy, and a WhatsApp chat with the driver with a message in `locale` prefilled. It's made when the driver is assigned, so this shows the same link every time. Needs `trips`.",
  middleware: staffRead,
  security: staffSecurity,
  request: { params: IdParam, query: ReportLinkQuery },
  responses: {
    200: { description: "The link", ...json(ReportLink) },
    400: invalid,
    ...staffProblems,
    404: notFound,
    409: problemResponse("REPORT_LINK_UNAVAILABLE: the trip has no driver."),
  },
});

const linkRegenerate = createRoute({
  method: "post",
  path: "/staff/trips/{id}/report-link",
  tags,
  summary: "Make a new report link",
  description:
    "Replaces the link: the one sent before stops working. Until the trip is completed or cancelled. Needs `trips`.",
  middleware: staffWrite,
  security: staffSecurity,
  request: { params: IdParam, query: ReportLinkQuery },
  responses: {
    200: { description: "The new link", ...json(ReportLink) },
    400: invalid,
    ...staffProblems,
    404: notFound,
    409: problemResponse(
      "REPORT_LINK_UNAVAILABLE (no driver), or TRIP_STATUS_CONFLICT (`tripStatus`).",
    ),
  },
});

const reportGet = createRoute({
  method: "get",
  path: "/staff/trips/{id}/report",
  tags,
  summary: "Get the report",
  description: "With its stops and expenses. Needs `trips`.",
  middleware: staffRead,
  security: staffSecurity,
  request: { params: IdParam },
  responses: {
    200: { description: "The report", ...json(TripReport) },
    ...staffProblems,
    404: problemResponse("NOT_FOUND: no such trip, or it has no report yet."),
  },
});

const reportPut = createRoute({
  method: "put",
  path: "/staff/trips/{id}/report",
  tags,
  summary: "Fill in or correct the report",
  description:
    "Replaces the whole report, while the trip awaits it (also after reopening). Staff can enter office fees. Needs `trips`.",
  middleware: staffWrite,
  security: staffSecurity,
  request: { params: IdParam, ...body(SubmitReport) },
  responses: {
    200: { description: "The report", ...json(TripReport) },
    400: invalid,
    ...staffProblems,
    404: notFound,
    409: problemResponse(
      "TRIP_STATUS_CONFLICT (`tripStatus`): the trip isn't awaiting its report.",
    ),
  },
});

export const staffReportRoutes = createRouter()
  .openapi(linkGet, async (c) =>
    c.json(await readReportLink(c.req.valid("param").id, c.req.valid("query").locale), 200),
  )
  .openapi(linkRegenerate, async (c) =>
    c.json(
      await regenerateReportLink(c.req.valid("param").id, staffId(c), c.req.valid("query").locale),
      200,
    ),
  )
  .openapi(reportGet, async (c) => c.json(await getReport(c.req.valid("param").id), 200))
  .openapi(reportPut, async (c) =>
    c.json(await putReport(c.req.valid("param").id, staffId(c), c.req.valid("json")), 200),
  );
