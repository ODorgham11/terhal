import { createRoute } from "@hono/zod-openapi";
import {
  Analytics,
  AnalyticsQuery,
  AnalyticsReport,
  AnalyticsReportLink,
  ExportTrips,
  ReportMonthParams,
  TRIP_EXPORT_LIMIT,
  page,
} from "@terhal/contracts";
import { z } from "zod";
import { createRouter, json, problemResponse } from "../../../platform/http/router";
import {
  exportCustomers,
  exportDrivers,
  exportPricingCsv,
  exportTrips,
  exportVehicles,
} from "../application/exports";
import { analytics } from "../application/metrics";
import { generateReport, listReports, reportLink } from "../application/reports";
import {
  analyticsExport,
  analyticsRead,
  analyticsWrite,
  csvResponse,
  security,
  signedIn,
  tripsExport,
} from "./shared";

const tags = ["Analytics"];
const rateLimited = { 429: problemResponse("RATE_LIMITED") };
const csv = (description: string) => ({
  description,
  content: { "text/csv": { schema: z.string() } },
});

const figures = createRoute({
  method: "get",
  path: "/staff/analytics",
  tags,
  summary: "Get the analytics page's figures",
  description:
    "For trips picking up from `from` to `to` (Cairo days, both included): totals, a trend by `groupBy`, breakdowns by class, car body, source and governorate pair, the fleet, costs and the margin. Revenue counts completed trips; booked value every trip not cancelled. Needs `analytics`.",
  middleware: analyticsRead,
  security,
  request: { query: AnalyticsQuery },
  responses: {
    200: { description: "The figures", ...json(Analytics) },
    400: problemResponse("VALIDATION_FAILED"),
    ...signedIn,
    ...rateLimited,
  },
});

const reports = createRoute({
  method: "get",
  path: "/staff/analytics/reports",
  tags,
  summary: "List the monthly reports",
  description:
    "Every month with a report, newest first. A report is generated on the 1st of each month (Cairo time) for the month before. Needs `analytics`.",
  middleware: analyticsRead,
  security,
  responses: {
    200: { description: "The reports", ...json(page(AnalyticsReport)) },
    ...signedIn,
    ...rateLimited,
  },
});

const download = createRoute({
  method: "get",
  path: "/staff/analytics/reports/{year}/{month}",
  tags,
  summary: "Get a link to a monthly report",
  description:
    "A signed link to the month's XLSX workbook, valid for 15 minutes. Needs `analytics`.",
  middleware: analyticsRead,
  security,
  request: { params: ReportMonthParams },
  responses: {
    200: { description: "The link", ...json(AnalyticsReportLink) },
    400: problemResponse("VALIDATION_FAILED"),
    ...signedIn,
    404: problemResponse("NOT_FOUND: the month has no report."),
    ...rateLimited,
  },
});

const regenerate = createRoute({
  method: "post",
  path: "/staff/analytics/reports/{year}/{month}/regenerate",
  tags,
  summary: "Generate a month's report again",
  description:
    "Writes the month's workbook from the data as it is now, replacing the earlier one, or makes it if there's none. Doing it twice gives the same result. Once a month has a report, its completed trips can't be reopened. Needs `analytics`.",
  middleware: analyticsWrite,
  security,
  request: { params: ReportMonthParams },
  responses: {
    200: { description: "The report", ...json(AnalyticsReport) },
    400: problemResponse("VALIDATION_FAILED"),
    ...signedIn,
    422: problemResponse("REPORT_MONTH_NOT_OVER: the month hasn't ended yet (Cairo time)."),
    ...rateLimited,
  },
});

const tripsCsv = createRoute({
  method: "get",
  path: "/staff/exports/trips.csv",
  tags,
  summary: "Download trips as CSV",
  description: `The trips matching the filters (the trip list's), oldest pickup first, at most ${String(TRIP_EXPORT_LIMIT)}; more is \`EXPORT_TOO_LARGE\` before anything is sent. UTF-8 with a byte order mark; text a spreadsheet would run as a formula starts with an apostrophe. Needs \`analytics\` or \`trips\`.`,
  middleware: tripsExport,
  security,
  request: { query: ExportTrips },
  responses: {
    200: csv("The trips"),
    400: problemResponse("VALIDATION_FAILED"),
    ...signedIn,
    422: problemResponse("EXPORT_TOO_LARGE (`count`, `limit`): narrow the filters."),
    ...rateLimited,
  },
});

const listCsv = (path: string, what: string) =>
  createRoute({
    method: "get",
    path: `/staff/exports/${path}.csv`,
    tags,
    summary: `Download ${what} as CSV`,
    description: `Every ${what.replace(/s$/, "")}, archived ones too, with the same encoding as the trips CSV. Needs \`analytics\`.`,
    middleware: analyticsExport,
    security,
    responses: { 200: csv(`The ${what}`), ...signedIn, ...rateLimited },
  });

const driversCsv = listCsv("drivers", "drivers");
const vehiclesCsv = listCsv("vehicles", "vehicles");
const customersCsv = createRoute({
  ...listCsv("customers", "customers"),
  description:
    "Every customer account except deleted ones, with how many trips each booked, with the same encoding as the trips CSV. Needs `analytics`.",
});
const pricingCsv = createRoute({
  ...listCsv("pricing", "prices"),
  description:
    "The price list, as the price list's own export (`/staff/pricing/export.csv`) gives it. Needs `analytics`.",
});

export const analyticsRoutes = createRouter()
  .openapi(figures, async (c) => c.json(await analytics(c.req.valid("query")), 200))
  .openapi(reports, async (c) => c.json(await listReports(), 200))
  .openapi(download, async (c) => c.json(await reportLink(c.req.valid("param")), 200))
  .openapi(regenerate, async (c) => c.json(await generateReport(c.req.valid("param")), 200))
  .openapi(tripsCsv, async (c) =>
    csvResponse(c, await exportTrips(c.req.valid("query")), "trips.csv"),
  )
  .openapi(driversCsv, (c) => csvResponse(c, exportDrivers(), "drivers.csv"))
  .openapi(vehiclesCsv, (c) => csvResponse(c, exportVehicles(), "vehicles.csv"))
  .openapi(customersCsv, (c) => csvResponse(c, exportCustomers(), "customers.csv"))
  .openapi(pricingCsv, async (c) => csvResponse(c, await exportPricingCsv(), "pricing.csv"));
