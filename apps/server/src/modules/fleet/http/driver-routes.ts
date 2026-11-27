import { createRoute } from "@hono/zod-openapi";
import {
  CreateDriver,
  Driver,
  DriverSummary,
  DriverTransaction,
  DriverTransactionRecorded,
  FleetTrip,
  IdParam,
  ListDriverTransactions,
  ListDrivers,
  ListFleetTrips,
  RecordDriverTransaction,
  UpdateDriver,
  page,
} from "@terhal/contracts";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
import {
  archiveDriver,
  createDriver,
  getDriver,
  listDriverTrips,
  listDrivers,
  restoreDriver,
  updateDriver,
} from "../application/drivers";
import {
  getDriverSummary,
  listDriverTransactions,
  recordDriverTransaction,
} from "../application/ledger";
import { actorOf, canRead, canWrite, security, staffProblems } from "./shared";

const tags = ["Drivers"];
const notFound = problemResponse("NOT_FOUND: there's no such driver.");
const invalid = problemResponse("VALIDATION_FAILED");
const officeProblems = problemResponse(
  "OFFICE_NOT_AVAILABLE: the office doesn't exist or is archived. OFFICE_REQUIRES_EXTERNAL: only an external driver can come through an office.",
);

const list = createRoute({
  method: "get",
  path: "/staff/drivers",
  tags,
  summary: "List drivers",
  description:
    "Live drivers by default, by name. `q` matches every word against the name, phone, licence number and national ID. Pass `nextCursor` back as `cursor` for the next page.",
  middleware: canRead,
  security,
  request: { query: ListDrivers },
  responses: {
    200: { description: "One page of drivers", ...json(page(Driver)) },
    400: invalid,
    ...staffProblems,
  },
});

const create = createRoute({
  method: "post",
  path: "/staff/drivers",
  tags,
  summary: "Add a driver",
  middleware: canWrite,
  security,
  request: body(CreateDriver),
  responses: {
    201: { description: "Added", ...json(Driver) },
    400: invalid,
    ...staffProblems,
    409: problemResponse("DRIVER_PHONE_TAKEN"),
    422: officeProblems,
  },
});

const get = createRoute({
  method: "get",
  path: "/staff/drivers/{id}",
  tags,
  summary: "Get a driver",
  middleware: canRead,
  security,
  request: { params: IdParam },
  responses: {
    200: { description: "The driver", ...json(Driver) },
    ...staffProblems,
    404: notFound,
  },
});

const update = createRoute({
  method: "patch",
  path: "/staff/drivers/{id}",
  tags,
  summary: "Change a driver",
  description: "Only the fields sent change; null clears an optional one.",
  middleware: canWrite,
  security,
  request: { params: IdParam, ...body(UpdateDriver) },
  responses: {
    200: { description: "Changed", ...json(Driver) },
    400: invalid,
    ...staffProblems,
    404: notFound,
    409: problemResponse("DRIVER_PHONE_TAKEN"),
    422: officeProblems,
  },
});

const archive = createRoute({
  method: "post",
  path: "/staff/drivers/{id}/archive",
  tags,
  summary: "Archive a driver",
  description:
    "Archived drivers can't be assigned. Refused while the driver is on a pending, confirmed or in-progress trip.",
  middleware: canWrite,
  security,
  request: { params: IdParam },
  responses: {
    200: { description: "Archived", ...json(Driver) },
    ...staffProblems,
    404: notFound,
    409: problemResponse("HAS_UPCOMING_TRIPS: `trips` lists them."),
  },
});

const restore = createRoute({
  method: "post",
  path: "/staff/drivers/{id}/restore",
  tags,
  summary: "Restore an archived driver",
  middleware: canWrite,
  security,
  request: { params: IdParam },
  responses: {
    200: { description: "Restored", ...json(Driver) },
    ...staffProblems,
    404: notFound,
  },
});

const trips = createRoute({
  method: "get",
  path: "/staff/drivers/{id}/trips",
  tags,
  summary: "List a driver's trips",
  description: "Newest pickup first.",
  middleware: canRead,
  security,
  request: { params: IdParam, query: ListFleetTrips },
  responses: {
    200: { description: "One page of trips", ...json(page(FleetTrip)) },
    400: invalid,
    ...staffProblems,
    404: notFound,
  },
});

const transactions = createRoute({
  method: "get",
  path: "/staff/drivers/{id}/transactions",
  tags,
  summary: "List a driver's ledger",
  description:
    "Every change to what the company owes the driver, newest first. The driver's `amountOwed` is their total.",
  middleware: canWrite,
  security,
  request: { params: IdParam, query: ListDriverTransactions },
  responses: {
    200: { description: "One page of entries", ...json(page(DriverTransaction)) },
    400: invalid,
    ...staffProblems,
    404: notFound,
  },
});

const record = createRoute({
  method: "post",
  path: "/staff/drivers/{id}/transactions",
  tags,
  summary: "Record a payment or an adjustment",
  description:
    "A payout's `amount` is what was paid to the driver and lowers the balance by that much; cash handed in is company cash the driver gave back and raises it by that much. An adjustment's is signed (positive when the company owes the driver more) and needs a note. Entries can't be changed or deleted: correct a mistake with another adjustment.",
  middleware: canWrite,
  security,
  request: { params: IdParam, ...body(RecordDriverTransaction) },
  responses: {
    201: { description: "Recorded", ...json(DriverTransactionRecorded) },
    400: invalid,
    ...staffProblems,
    404: notFound,
  },
});

const summary = createRoute({
  method: "get",
  path: "/staff/drivers/{id}/summary",
  tags,
  summary: "Sum up a driver's ledger and month",
  description:
    "The ledger's totals by kind (all time), and this month's completed trips, kilometres and fees (Cairo time).",
  middleware: canWrite,
  security,
  request: { params: IdParam },
  responses: {
    200: { description: "The summary", ...json(DriverSummary) },
    ...staffProblems,
    404: notFound,
  },
});

export const driverRoutes = createRouter()
  .openapi(list, async (c) => c.json(await listDrivers(c.req.valid("query")), 200))
  .openapi(create, async (c) => c.json(await createDriver(c.req.valid("json"), actorOf(c)), 201))
  .openapi(get, async (c) => c.json(await getDriver(c.req.valid("param").id), 200))
  .openapi(update, async (c) =>
    c.json(await updateDriver(c.req.valid("param").id, c.req.valid("json"), actorOf(c)), 200),
  )
  .openapi(archive, async (c) =>
    c.json(await archiveDriver(c.req.valid("param").id, actorOf(c)), 200),
  )
  .openapi(restore, async (c) =>
    c.json(await restoreDriver(c.req.valid("param").id, actorOf(c)), 200),
  )
  .openapi(trips, async (c) =>
    c.json(await listDriverTrips(c.req.valid("param").id, c.req.valid("query")), 200),
  )
  .openapi(summary, async (c) => c.json(await getDriverSummary(c.req.valid("param").id), 200))
  .openapi(transactions, async (c) =>
    c.json(await listDriverTransactions(c.req.valid("param").id, c.req.valid("query")), 200),
  )
  .openapi(record, async (c) =>
    c.json(
      await recordDriverTransaction(c.req.valid("param").id, c.req.valid("json"), actorOf(c)),
      201,
    ),
  );
