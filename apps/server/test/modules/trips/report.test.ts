import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../src/platform/db/prisma";
import { resetDatabase } from "../../support/database";
import { SITE_ORIGIN, createAgent } from "../../support/http";
import { resetRedis } from "../../support/redis";
import {
  act,
  bookedTrip,
  events,
  fleet,
  json,
  signedInCustomer,
  tripWorld,
  tripsStaff,
  type Agent,
  type TripWorld,
} from "../../support/trips";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

const problem = (response: Response) =>
  json<{ code: string; tripStatus?: string; errors?: { path: string }[] }>(response);

interface Link {
  url: string;
  whatsappUrl: string;
  message: string;
  expiresAt: string;
  driver: { id: string; phone: string };
}

interface DriverView {
  code: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  report: { cashCollected: string; expenses: unknown[]; stops: unknown[] } | null;
  [key: string]: unknown;
}

let world: TripWorld;
let staff: Agent;
let staffId: string;
let site: Agent;
let driverAgent: Agent;

beforeEach(async () => {
  world = await tripWorld();
  const signedIn = await tripsStaff(["trips", "fleet"]);
  staff = signedIn.agent;
  staffId = signedIn.staff.id;
  site = (await signedInCustomer()).agent;
  driverAgent = createAgent(SITE_ORIGIN);
});

const assign = (id: string, body: unknown) =>
  staff.request(`/v1/staff/trips/${id}/assignment`, { method: "PUT", json: body });

const getLink = (id: string, locale?: string) =>
  staff.request(`/v1/staff/trips/${id}/report-link${locale ? `?locale=${locale}` : ""}`);

const tokenOf = (link: Link) => link.url.split("#")[1] ?? "";

const asDriver = (token: string, path = "", init: RequestInit & { json?: unknown } = {}) =>
  driverAgent.request(`/v1/site/driver/report${path}`, {
    ...init,
    headers: { "Report-Token": token },
  });

// A confirmed trip with a driver and a vehicle, and the driver's link.
const assignedTrip = async ({ external = false } = {}) => {
  const { trip } = await bookedTrip(site, world);
  const { driver, vehicle } = await fleet();
  if (external)
    await prisma.driver.update({ where: { id: driver.id }, data: { isExternal: true } });
  expect((await act(staff, trip.id, "confirm")).status).toBe(200);
  expect((await assign(trip.id, { driverId: driver.id, vehicleId: vehicle.id })).status).toBe(200);
  const link = await json<Link>(await getLink(trip.id));
  return { trip, driver, vehicle, link, token: tokenOf(link) };
};

const hour = (from: Date, hours: number) =>
  new Date(from.getTime() + hours * 60 * 60 * 1000).toISOString();

// A full report, everything required; times run from `start`.
const report = (overrides: Record<string, unknown> = {}, start = new Date()) => ({
  startedAt: hour(start, 0),
  vehiclePickup: "The garage in Maadi",
  startMileage: 12000,
  pickupAt: hour(start, 1),
  dropoffAt: hour(start, 4),
  vehicleDropoff: "The garage in Maadi",
  endedAt: hour(start, 5),
  endMileage: 12450,
  cashCollected: "0",
  stops: [
    {
      address: "Rest stop on the desert road",
      startedAt: hour(start, 2),
      endedAt: hour(start, 2.5),
    },
    { latitude: 30.5, longitude: 30.9, startedAt: hour(start, 3), endedAt: hour(start, 3.2) },
  ],
  expenses: [{ type: "INTERCITY_TOLL", amount: "40", notes: "Toll gate" }],
  ...overrides,
});

const submit = (token: string, body: unknown) => asDriver(token, "", { method: "PUT", json: body });

const putReport = (id: string, body: unknown) =>
  staff.request(`/v1/staff/trips/${id}/report`, { method: "PUT", json: body });

const ledger = (driverId: string) =>
  prisma.driverTransaction.findMany({
    where: { driverId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

const owed = async (driverId: string) =>
  (await prisma.driver.findUniqueOrThrow({ where: { id: driverId } })).amountOwed.toFixed(2);

describe("the report link", () => {
  it("is issued on assignment and shown the same every time, to copy or send on WhatsApp", async () => {
    const { trip, driver, link } = await assignedTrip();
    expect(link.url).toMatch(/^https:\/\/local\.terhal\.co:3000\/report#[\w-]{43}$/);
    expect(link.driver).toMatchObject({ id: driver.id, phone: driver.phone });
    expect(new Date(link.expiresAt).getTime()).toBe(
      new Date(trip.pickupDate).getTime() + 7 * 24 * 60 * 60 * 1000,
    );
    // Arabic by default, with the trip's code and the link.
    expect(link.message).toContain("مرحبًا");
    expect(link.message).toContain(trip.code);
    expect(link.message).toContain(link.url);
    expect(link.whatsappUrl).toBe(
      `https://wa.me/${driver.phone.slice(1)}?text=${encodeURIComponent(link.message)}`,
    );
    const english = await json<Link>(await getLink(trip.id, "en"));
    expect(english.url).toBe(link.url);
    expect(english.message).toMatch(/^Hi Driver\d+, here's the report link for trip TRH-/);

    // Only the hash is stored.
    const row = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    expect(row.reportTokenHash).not.toBe(tokenOf(link));
    expect(JSON.stringify(row)).not.toContain(tokenOf(link));
  });

  it("is made again on request, and the old one stops working", async () => {
    const { trip, token } = await assignedTrip();
    const response = await staff.request(`/v1/staff/trips/${trip.id}/report-link`, {
      method: "POST",
    });
    expect(response.status).toBe(200);
    const fresh = tokenOf(await json<Link>(response));
    expect(fresh).not.toBe(token);
    expect((await problem(await asDriver(token))).code).toBe("REPORT_LINK_INVALID");
    expect((await asDriver(fresh)).status).toBe(200);
    expect((await events(trip.id)).at(-1)).toMatchObject({
      action: "trip.report_link_issued",
      staffId,
      data: {},
    });
  });

  it("stops working when the driver changes, and the new driver gets their own", async () => {
    const { trip, vehicle, token } = await assignedTrip();
    const other = await fleet();
    await assign(trip.id, { driverId: other.driver.id, vehicleId: vehicle.id });
    expect((await problem(await asDriver(token))).code).toBe("REPORT_LINK_INVALID");
    const link = await json<Link>(await getLink(trip.id));
    expect(link.driver.id).toBe(other.driver.id);
    expect((await asDriver(tokenOf(link))).status).toBe(200);
  });

  it("isn't there without a driver, and needs `trips`", async () => {
    const { trip } = await bookedTrip(site, world);
    const missing = await getLink(trip.id);
    expect(missing.status).toBe(409);
    expect((await problem(missing)).code).toBe("REPORT_LINK_UNAVAILABLE");
    const regenerate = await staff.request(`/v1/staff/trips/${trip.id}/report-link`, {
      method: "POST",
    });
    expect((await problem(regenerate)).code).toBe("REPORT_LINK_UNAVAILABLE");
    expect((await getLink("nope")).status).toBe(404);

    const fleetOnly = (await tripsStaff(["fleet"], "fleet.only@terhal.co")).agent;
    expect((await fleetOnly.request(`/v1/staff/trips/${trip.id}/report-link`)).status).toBe(403);
    expect((await fleetOnly.request(`/v1/staff/trips/${trip.id}/report`)).status).toBe(403);
  });

  it("expires 7 days after pickup, and moves with the pickup", async () => {
    const { trip, token } = await assignedTrip();
    const later = new Date(new Date(trip.pickupDate).getTime() + 24 * 60 * 60 * 1000);
    await staff.request(`/v1/staff/trips/${trip.id}`, {
      method: "PATCH",
      json: { pickupDate: later.toISOString() },
    });
    const moved = await json<Link>(await getLink(trip.id));
    expect(new Date(moved.expiresAt).getTime()).toBe(later.getTime() + 7 * 24 * 60 * 60 * 1000);

    await prisma.trip.update({
      where: { id: trip.id },
      data: { reportTokenExpiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await asDriver(token);
    expect(expired.status).toBe(401);
    expect((await problem(expired)).code).toBe("REPORT_LINK_EXPIRED");
  });
});

describe("the driver, through the link", () => {
  it("needs a token that matches a trip", async () => {
    expect((await driverAgent.request("/v1/site/driver/report")).status).toBe(400);
    const wrong = await asDriver("x".repeat(43));
    expect(wrong.status).toBe(401);
    expect((await problem(wrong)).code).toBe("REPORT_LINK_INVALID");
  });

  it("sees the trip, starts and ends it, and the events name them", async () => {
    const { trip, driver, vehicle, token } = await assignedTrip();
    const view = await json<DriverView>(await asDriver(token));
    expect(view).toMatchObject({
      code: trip.code,
      status: "CONFIRMED",
      clientName: trip.clientName,
      pickup: { nameEn: "Degla", nameAr: "دجلة" },
      dropoff: { nameEn: "Smouha" },
      class: { nameEn: "Economy" },
      driver: { firstName: driver.firstName },
      vehicle: { plateNumber: vehicle.plateNumber },
      startedAt: null,
      endedAt: null,
      report: null,
    });

    const early = await asDriver(token, "/end", { method: "POST" });
    expect(early.status).toBe(409);
    expect((await problem(early)).tripStatus).toBe("CONFIRMED");

    const started = await json<DriverView>(await asDriver(token, "/start", { method: "POST" }));
    expect(started.status).toBe("IN_PROGRESS");
    expect(started.startedAt).not.toBeNull();
    const ended = await json<DriverView>(await asDriver(token, "/end", { method: "POST" }));
    expect(ended.status).toBe("AWAITING_REPORT");
    expect(ended.endedAt).not.toBeNull();

    const moves = (await events(trip.id)).slice(-2);
    expect(moves.map((event) => [event.action, event.driverId, event.staffId])).toEqual([
      ["trip.started", driver.id, null],
      ["trip.ended", driver.id, null],
    ]);
    // The dashboard's history names the driver too.
    const detail = await json<{ events: { actor: unknown }[] }>(
      await staff.request(`/v1/staff/trips/${trip.id}`),
    );
    expect(detail.events.at(-1)?.actor).toEqual({
      type: "DRIVER",
      id: driver.id,
      name: `${driver.firstName} ${driver.lastName}`,
    });
  });

  it("can't start a trip the database says the driver is already busy on another", async () => {
    const first = await assignedTrip();
    const { trip: other } = await bookedTrip(site, world);
    await prisma.trip.update({
      where: { id: other.id },
      data: { status: "IN_PROGRESS", driverId: first.driver.id },
    });
    const busy = await asDriver(first.token, "/start", { method: "POST" });
    expect(busy.status).toBe(409);
    expect((await problem(busy)).code).toBe("ASSIGNEE_BUSY");
  });

  it("submits the whole report once, ending a trip still in progress", async () => {
    const { trip, driver, token } = await assignedTrip();
    await asDriver(token, "/start", { method: "POST" });

    const response = await submit(token, report({ cashCollected: "1500" }));
    expect(response.status).toBe(200);
    const view = await json<DriverView>(response);
    expect(view.status).toBe("AWAITING_REPORT");
    expect(view.report).toMatchObject({
      cashCollected: "1500.00",
      vehiclePickup: "The garage in Maadi",
      stops: [
        { address: "Rest stop on the desert road", latitude: null, longitude: null },
        { address: null, latitude: 30.5, longitude: 30.9 },
      ],
      expenses: [{ type: "INTERCITY_TOLL", amount: "40.00", notes: "Toll gate" }],
    });
    expect(
      (await events(trip.id)).slice(-3).map((event) => [event.action, event.driverId]),
    ).toEqual([
      ["trip.ended", driver.id],
      ["trip.report_submitted", driver.id],
      ["trip.payment_recorded", driver.id],
    ]);
    // The cash settles the unpaid trip.
    expect(await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).toMatchObject({
      paymentMethod: "CASH_TO_DRIVER",
    });

    const again = await submit(token, report());
    expect(again.status).toBe(409);
    expect((await problem(again)).code).toBe("REPORT_ALREADY_SUBMITTED");
  });

  it("can't report a trip that hasn't started", async () => {
    const { token } = await assignedTrip();
    const response = await submit(token, report());
    expect(response.status).toBe(409);
    expect((await problem(response)).tripStatus).toBe("CONFIRMED");
  });

  it("refuses an incomplete or inconsistent report, and office fees", async () => {
    const { token } = await assignedTrip();
    const start = new Date();
    const cases: [Record<string, unknown>, string][] = [
      [{ vehiclePickup: undefined }, "vehiclePickup"],
      [{ stops: undefined }, "stops"],
      [{ endMileage: 100 }, "endMileage"],
      [{ dropoffAt: hour(start, 0.5) }, "dropoffAt"],
      [{ cashCollected: "-5" }, "cashCollected"],
      [
        {
          stops: [
            {
              address: "Both",
              latitude: 30,
              longitude: 31,
              startedAt: hour(start, 2),
              endedAt: hour(start, 3),
            },
          ],
        },
        "stops.0.address",
      ],
      [
        { stops: [{ latitude: 30, startedAt: hour(start, 2), endedAt: hour(start, 3) }] },
        "stops.0.longitude",
      ],
      [
        { stops: [{ address: "Late", startedAt: hour(start, 2), endedAt: hour(start, 9) }] },
        "stops.0.startedAt",
      ],
      [{ expenses: [{ type: "FUEL", amount: "0" }] }, "expenses.0.amount"],
      [{ expenses: [{ type: "OFFICE_FEE", amount: "300" }] }, "expenses.0.type"],
    ];
    for (const [overrides, path] of cases) {
      const response = await submit(token, report(overrides, start));
      expect(response.status, path).toBe(400);
      expect((await problem(response)).errors?.map((error) => error.path)).toContain(path);
    }
  });

  it("is rate limited per IP", async () => {
    const statuses = [];
    for (let index = 0; index < 61; index += 1) {
      statuses.push((await asDriver("y".repeat(43))).status);
    }
    expect(statuses.slice(0, 60).every((status) => status === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("staff and the report", () => {
  it("fill it in once the trip has ended, and correct it until it's completed", async () => {
    const { trip, token } = await assignedTrip();
    expect((await staff.request(`/v1/staff/trips/${trip.id}/report`)).status).toBe(404);
    const early = await putReport(trip.id, report());
    expect(early.status).toBe(409);
    expect((await problem(early)).tripStatus).toBe("CONFIRMED");

    await act(staff, trip.id, "start");
    await act(staff, trip.id, "end");
    await submit(token, report());

    const corrected = await putReport(
      trip.id,
      report({ expenses: [{ type: "OFFICE_FEE", amount: "300" }], stops: [] }),
    );
    expect(corrected.status).toBe(200);
    expect(await json(corrected)).toMatchObject({
      expenses: [{ type: "OFFICE_FEE", amount: "300.00" }],
      stops: [],
    });
    expect((await events(trip.id)).at(-1)).toMatchObject({
      action: "trip.report_edited",
      staffId,
    });
    expect(await json(await staff.request(`/v1/staff/trips/${trip.id}/report`))).toMatchObject({
      expenses: [{ type: "OFFICE_FEE" }],
    });

    expect((await act(staff, trip.id, "complete")).status).toBe(200);
    const locked = await putReport(trip.id, report());
    expect((await problem(locked)).tripStatus).toBe("COMPLETED");
  });

  it("complete an office trip without a report", async () => {
    const { trip } = await bookedTrip(site, world);
    const office = await prisma.office.create({
      data: { name: "Partner", contact: "Ali", phone: "+201000000009", address: "Cairo" },
    });
    await act(staff, trip.id, "confirm");
    await assign(trip.id, { officeId: office.id });
    await act(staff, trip.id, "start");
    await act(staff, trip.id, "end");
    expect((await act(staff, trip.id, "complete")).status).toBe(200);
    expect(await prisma.driverTransaction.count()).toBe(0);
  });
});

describe("the database", () => {
  it("holds a stop to an address or a pin, exactly one", async () => {
    const { trip } = await bookedTrip(site, world);
    const now = new Date();
    const row = await prisma.tripReport.create({
      data: {
        tripId: trip.id,
        startedAt: now,
        vehiclePickup: "A",
        startMileage: 1,
        pickupAt: now,
        dropoffAt: now,
        vehicleDropoff: "B",
        endedAt: now,
        endMileage: 2,
      },
    });
    const stop = (data: Record<string, unknown>) =>
      prisma.tripStop.create({
        data: { reportId: row.id, startedAt: now, endedAt: now, ...data },
      });
    await expect(stop({})).rejects.toThrow(/TripStop_address_or_pin/);
    await expect(stop({ address: "A", latitude: 30, longitude: 31 })).rejects.toThrow(
      /TripStop_address_or_pin/,
    );
    await expect(stop({ latitude: 30 })).rejects.toThrow(/TripStop_address_or_pin/);
    await expect(stop({ address: "A" })).resolves.toBeDefined();
    await expect(stop({ latitude: 30, longitude: 31 })).resolves.toBeDefined();
    await expect(
      prisma.tripReport.update({ where: { id: row.id }, data: { cashCollected: "-1" } }),
    ).rejects.toThrow(/TripReport_cash_collected/);
  });
});

describe("the driver ledger", () => {
  const expenses = [
    { type: "DRIVER_FEE", amount: "500" },
    { type: "FUEL", amount: "150.50" },
    { type: "INTERCITY_TOLL", amount: "49.50" },
    { type: "OFFICE_FEE", amount: "300" },
  ];

  const endWithReport = async (tripId: string, body: unknown) => {
    await act(staff, tripId, "start");
    await act(staff, tripId, "end");
    expect((await putReport(tripId, body)).status).toBe(200);
  };

  it("pays an external driver's fee and expenses less the cash, and never an office fee", async () => {
    const { trip, driver } = await assignedTrip({ external: true });
    await endWithReport(trip.id, report({ expenses, cashCollected: "1500" }));
    expect((await act(staff, trip.id, "complete")).status).toBe(200);

    const rows = await ledger(driver.id);
    expect(rows.map((row) => [row.type, row.amount.toFixed(2), row.tripId, row.staffId])).toEqual([
      ["TRIP_FEE", "500.00", trip.id, staffId],
      ["EXPENSE_REIMBURSEMENT", "200.00", trip.id, staffId],
      ["CASH_COLLECTED", "-1500.00", trip.id, staffId],
    ]);
    expect(await owed(driver.id)).toBe("-800.00");
  });

  it("gives an internal driver no trip fee", async () => {
    const { trip, driver } = await assignedTrip();
    await endWithReport(trip.id, report({ expenses }));
    await act(staff, trip.id, "complete");
    expect((await ledger(driver.id)).map((row) => [row.type, row.amount.toFixed(2)])).toEqual([
      ["EXPENSE_REIMBURSEMENT", "200.00"],
    ]);
    expect(await owed(driver.id)).toBe("200.00");
  });

  it("writes nothing for a report with nothing owed either way", async () => {
    const { trip, driver } = await assignedTrip();
    await endWithReport(trip.id, report({ expenses: [] }));
    await act(staff, trip.id, "complete");
    expect(await ledger(driver.id)).toEqual([]);
  });

  it("reverses a reopened trip, and counts it once when it's completed again", async () => {
    const { trip, driver } = await assignedTrip({ external: true });
    await endWithReport(trip.id, report({ expenses, cashCollected: "1500" }));
    await act(staff, trip.id, "complete");
    expect(await owed(driver.id)).toBe("-800.00");

    expect((await act(staff, trip.id, "reopen")).status).toBe(200);
    expect(await owed(driver.id)).toBe("0.00");
    expect((await ledger(driver.id)).at(-1)).toMatchObject({ type: "ADJUSTMENT", tripId: trip.id });
    expect((await ledger(driver.id)).at(-1)?.amount.toFixed(2)).toBe("800.00");

    // The report is corrected: more fuel, less cash.
    const fixed = report({
      expenses: [...expenses, { type: "FUEL", amount: "100" }],
      cashCollected: "1000",
    });
    expect((await putReport(trip.id, fixed)).status).toBe(200);
    await act(staff, trip.id, "complete");
    expect(await owed(driver.id)).toBe("-200.00");

    // Reopening twice in a row and completing again still counts it once.
    await act(staff, trip.id, "reopen");
    await act(staff, trip.id, "complete");
    expect(await owed(driver.id)).toBe("-200.00");
    expect((await ledger(driver.id)).map((row) => row.type)).toEqual([
      "TRIP_FEE",
      "EXPENSE_REIMBURSEMENT",
      "CASH_COLLECTED",
      "ADJUSTMENT",
      "TRIP_FEE",
      "EXPENSE_REIMBURSEMENT",
      "CASH_COLLECTED",
      "ADJUSTMENT",
      "TRIP_FEE",
      "EXPENSE_REIMBURSEMENT",
      "CASH_COLLECTED",
    ]);
  });

  it("leaves staff payouts alone when a trip is reopened", async () => {
    const { trip, driver } = await assignedTrip();
    await endWithReport(trip.id, report({ expenses }));
    await act(staff, trip.id, "complete");
    const payout = await staff.request(`/v1/staff/drivers/${driver.id}/transactions`, {
      method: "POST",
      json: { type: "PAYOUT", amount: "200" },
    });
    expect(payout.status).toBe(201);
    expect(await owed(driver.id)).toBe("0.00");
    await act(staff, trip.id, "reopen");
    expect(await owed(driver.id)).toBe("-200.00");
  });
});
