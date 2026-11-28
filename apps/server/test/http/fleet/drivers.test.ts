import type {
  Driver,
  DriverSummary,
  DriverTransaction,
  DriverTransactionRecorded,
  FleetTrip,
} from "@terhal/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../src/platform/db/prisma";
import { resetDatabase } from "../../support/database";
import { bodyOf, createTrip, signedInStaff, type Agent, type Page } from "../../support/fleet";
import { resetRedis } from "../../support/redis";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

const DAY = 24 * 60 * 60 * 1000;
const isoDate = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

// Each driver's licence follows their phone, so drivers added with different phones never share one.
const driverInput = (overrides: Record<string, unknown> = {}) => {
  const input = {
    firstName: "Mahmoud",
    lastName: "Hassan",
    phone: "01001234567",
    licenseExpiresAt: isoDate(365),
    ...overrides,
  };
  return { licenseNumber: `LIC-${input.phone}`, ...input };
};

const addDriver = async (agent: Agent, overrides: Record<string, unknown> = {}) => {
  const response = await agent.request("/v1/staff/drivers", {
    method: "POST",
    json: driverInput(overrides),
  });
  expect(response.status).toBe(201);
  return bodyOf<Driver>(response);
};

const office = (name = "Cairo Rentals") =>
  prisma.office.create({
    data: { name, contact: "Ali", phone: "+201000000009", address: "Cairo" },
  });

describe("creating and changing drivers", () => {
  it("adds a driver with a normalized phone, a zero balance and an audit record", async () => {
    const { agent, staff } = await signedInStaff();
    const driver = await addDriver(agent, { nationalId: "29801011234567" });

    expect(driver).toMatchObject({
      firstName: "Mahmoud",
      phone: "+201001234567",
      licenseNumber: "LIC-01001234567",
      licenseExpiresSoon: false,
      nationalId: "29801011234567",
      isExternal: false,
      office: null,
      amountOwed: "0.00",
      archivedAt: null,
    });

    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: driver.id } });
    expect(log).toMatchObject({
      action: "fleet.driver.created",
      staffId: staff.id,
      adminId: null,
      entityType: "Driver",
    });
  });

  it("requires the licence number and expiry", async () => {
    const { agent } = await signedInStaff();
    const response = await agent.request("/v1/staff/drivers", {
      method: "POST",
      json: { firstName: "Mahmoud", lastName: "Hassan", phone: "01001234567" },
    });
    expect(response.status).toBe(400);
    const paths = (await bodyOf(response)).errors.map((error: { path: string }) => error.path);
    expect(paths).toEqual(expect.arrayContaining(["licenseNumber", "licenseExpiresAt"]));
  });

  it("refuses a phone another driver has", async () => {
    const { agent } = await signedInStaff();
    await addDriver(agent);
    const response = await agent.request("/v1/staff/drivers", {
      method: "POST",
      json: driverInput({ phone: "+201001234567" }),
    });
    expect(response.status).toBe(409);
    expect((await bodyOf(response)).code).toBe("DRIVER_PHONE_TAKEN");
  });

  it("takes a national ID of exactly 14 digits", async () => {
    const { agent } = await signedInStaff();
    for (const nationalId of ["2980101123456", "298010112345678", "2980101123456X"]) {
      const response = await agent.request("/v1/staff/drivers", {
        method: "POST",
        json: driverInput({ nationalId }),
      });
      expect(response.status, nationalId).toBe(400);
    }
  });

  it("refuses a national ID or a licence another driver has, archived or not", async () => {
    const { agent } = await signedInStaff();
    const first = await addDriver(agent, { nationalId: "29801011234567", licenseNumber: "ab-12" });
    await agent.request(`/v1/staff/drivers/${first.id}/archive`, { method: "POST" });

    const sameId = await agent.request("/v1/staff/drivers", {
      method: "POST",
      json: driverInput({ phone: "01002222222", nationalId: "29801011234567" }),
    });
    expect(sameId.status).toBe(409);
    expect((await bodyOf(sameId)).code).toBe("DRIVER_NATIONAL_ID_TAKEN");

    // Whatever its case.
    const sameLicence = await agent.request("/v1/staff/drivers", {
      method: "POST",
      json: driverInput({ phone: "01003333333", licenseNumber: "AB-12" }),
    });
    expect(sameLicence.status).toBe(409);
    expect((await bodyOf(sameLicence)).code).toBe("DRIVER_LICENSE_TAKEN");
  });

  it("links only external drivers to an office (the database check)", async () => {
    const { agent } = await signedInStaff();
    const rentals = await office();

    const internal = await agent.request("/v1/staff/drivers", {
      method: "POST",
      json: driverInput({ officeId: rentals.id }),
    });
    expect(internal.status).toBe(422);
    expect((await bodyOf(internal)).code).toBe("OFFICE_REQUIRES_EXTERNAL");

    const external = await addDriver(agent, { isExternal: true, officeId: rentals.id });
    expect(external.office).toEqual({ id: rentals.id, name: "Cairo Rentals", archived: false });

    // Turning the driver internal while the link stays is refused too.
    const update = await agent.request(`/v1/staff/drivers/${external.id}`, {
      method: "PATCH",
      json: { isExternal: false },
    });
    expect(update.status).toBe(422);
    expect((await bodyOf(update)).code).toBe("OFFICE_REQUIRES_EXTERNAL");
  });

  it("refuses an archived or unknown office", async () => {
    const { agent } = await signedInStaff();
    const archived = await prisma.office.update({
      where: { id: (await office()).id },
      data: { archivedAt: new Date() },
    });
    for (const officeId of [archived.id, "missing"]) {
      const response = await agent.request("/v1/staff/drivers", {
        method: "POST",
        json: driverInput({ isExternal: true, officeId }),
      });
      expect(response.status).toBe(422);
      expect((await bodyOf(response)).code).toBe("OFFICE_NOT_AVAILABLE");
    }
  });

  it("changes only the fields sent and records before and after", async () => {
    const { agent } = await signedInStaff();
    const driver = await addDriver(agent, { notes: "Night shifts" });

    const response = await agent.request(`/v1/staff/drivers/${driver.id}`, {
      method: "PATCH",
      json: { lastName: "Saleh", notes: null },
    });
    expect(response.status).toBe(200);
    expect(await bodyOf<Driver>(response)).toMatchObject({
      firstName: "Mahmoud",
      lastName: "Saleh",
      notes: null,
    });

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: driver.id, action: "fleet.driver.updated" },
    });
    expect(log.before).toEqual({ lastName: "Hassan", notes: "Night shifts" });
    expect(log.after).toEqual({ lastName: "Saleh", notes: null });
  });

  it("answers 404 for an unknown driver", async () => {
    const { agent } = await signedInStaff();
    for (const [method, path] of [
      ["GET", "/v1/staff/drivers/missing"],
      ["PATCH", "/v1/staff/drivers/missing"],
      ["POST", "/v1/staff/drivers/missing/archive"],
      ["POST", "/v1/staff/drivers/missing/restore"],
      ["GET", "/v1/staff/drivers/missing/trips"],
      ["GET", "/v1/staff/drivers/missing/transactions"],
    ] as const) {
      const response = await agent.request(path, {
        method,
        ...(method === "PATCH" && { json: { notes: "x" } }),
      });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
  });
});

describe("listing drivers", () => {
  it("searches, filters and pages", async () => {
    const { agent } = await signedInStaff();
    await addDriver(agent, { firstName: "Ahmed", phone: "01001111111" });
    await addDriver(agent, { firstName: "Bassem", phone: "01002222222", isExternal: true });
    const archived = await addDriver(agent, { firstName: "Camilia", phone: "01003333333" });
    await agent.request(`/v1/staff/drivers/${archived.id}/archive`, { method: "POST" });

    const names = async (query: string) => {
      const body = await bodyOf<Page<Driver>>(await agent.request(`/v1/staff/drivers${query}`));
      return body.data.map((driver: { firstName: string }) => driver.firstName);
    };

    expect(await names("")).toEqual(["Ahmed", "Bassem"]);
    expect(await names("?archived=true")).toEqual(["Camilia"]);
    expect(await names("?external=true")).toEqual(["Bassem"]);
    expect(await names("?q=ahmed%20hassan")).toEqual(["Ahmed"]);
    expect(await names("?q=0100222")).toEqual(["Bassem"]);

    const first = await bodyOf<Page<Driver>>(await agent.request("/v1/staff/drivers?limit=1"));
    expect(first.data).toHaveLength(1);
    const second = await bodyOf<Page<Driver>>(
      await agent.request(`/v1/staff/drivers?limit=1&cursor=${first.nextCursor}`),
    );
    expect(second.data[0]?.firstName).toBe("Bassem");
    expect(second.nextCursor).toBeNull();
  });

  it("matches Arabic names whatever the alef form typed", async () => {
    const { agent } = await signedInStaff();
    await addDriver(agent, { firstName: "احمد", lastName: "علي" });
    const body = await bodyOf<Page<Driver>>(
      await agent.request(`/v1/staff/drivers?q=${encodeURIComponent("أحمد")}`),
    );
    expect(body.data).toHaveLength(1);
  });

  it("flags and filters licences that expire within 30 days", async () => {
    const { agent } = await signedInStaff();
    await addDriver(agent, {
      firstName: "Expired",
      phone: "01001111111",
      licenseExpiresAt: isoDate(-3),
    });
    await addDriver(agent, {
      firstName: "Soon",
      phone: "01002222222",
      licenseExpiresAt: isoDate(20),
    });
    await addDriver(agent, {
      firstName: "Later",
      phone: "01003333333",
      licenseExpiresAt: isoDate(60),
    });

    const all = await bodyOf<Page<Driver>>(await agent.request("/v1/staff/drivers"));
    const flags = Object.fromEntries(
      all.data.map((driver: { firstName: string; licenseExpiresSoon: boolean }) => [
        driver.firstName,
        driver.licenseExpiresSoon,
      ]),
    );
    expect(flags).toEqual({ Expired: true, Later: false, Soon: true });

    const expiring = await bodyOf<Page<Driver>>(
      await agent.request("/v1/staff/drivers?licenseExpiring=true"),
    );
    expect(expiring.data.map((driver: { firstName: string }) => driver.firstName)).toEqual([
      "Expired",
      "Soon",
    ]);
  });
});

describe("archiving drivers", () => {
  it("is blocked while the driver is on a live trip", async () => {
    const { agent } = await signedInStaff();
    const driver = await addDriver(agent);
    const trip = await createTrip({ driverId: driver.id, status: "CONFIRMED" });

    const blocked = await agent.request(`/v1/staff/drivers/${driver.id}/archive`, {
      method: "POST",
    });
    expect(blocked.status).toBe(409);
    const problem = await bodyOf(blocked);
    expect(problem.code).toBe("HAS_UPCOMING_TRIPS");
    expect(problem.trips).toEqual([expect.objectContaining({ id: trip.id, code: trip.code })]);

    await prisma.trip.update({ where: { id: trip.id }, data: { status: "COMPLETED" } });
    const archived = await agent.request(`/v1/staff/drivers/${driver.id}/archive`, {
      method: "POST",
    });
    expect(archived.status).toBe(200);
    expect((await bodyOf<Driver>(archived)).archivedAt).not.toBeNull();
  });

  it("archives and restores, recording each once", async () => {
    const { agent } = await signedInStaff();
    const driver = await addDriver(agent);

    for (let i = 0; i < 2; i++) {
      const response = await agent.request(`/v1/staff/drivers/${driver.id}/archive`, {
        method: "POST",
      });
      expect(response.status).toBe(200);
    }
    const restored = await agent.request(`/v1/staff/drivers/${driver.id}/restore`, {
      method: "POST",
    });
    expect((await bodyOf<Driver>(restored)).archivedAt).toBeNull();

    const actions = await prisma.auditLog.findMany({
      where: { entityId: driver.id },
      orderBy: { createdAt: "asc" },
      select: { action: true },
    });
    expect(actions.map((log) => log.action)).toEqual([
      "fleet.driver.created",
      "fleet.driver.archived",
      "fleet.driver.restored",
    ]);
  });
});

describe("a driver's trips", () => {
  it("lists them newest pickup first, filtered by status", async () => {
    const { agent } = await signedInStaff();
    const driver = await addDriver(agent);
    const older = await createTrip({
      driverId: driver.id,
      status: "COMPLETED",
      pickupDate: new Date(Date.now() - 2 * DAY),
    });
    const newer = await createTrip({ driverId: driver.id, status: "CONFIRMED" });
    await createTrip({ status: "CONFIRMED" });

    const all = await bodyOf<Page<FleetTrip>>(
      await agent.request(`/v1/staff/drivers/${driver.id}/trips`),
    );
    expect(all.data.map((trip: { id: string }) => trip.id)).toEqual([newer.id, older.id]);
    expect(all.data[0]).toMatchObject({
      code: newer.code,
      status: "CONFIRMED",
      pickup: "Pickup",
      dropoff: "Drop-off",
      car: "SEDAN",
      driver: { id: driver.id, firstName: "Mahmoud", lastName: "Hassan" },
    });

    const completed = await bodyOf<Page<FleetTrip>>(
      await agent.request(`/v1/staff/drivers/${driver.id}/trips?status=COMPLETED`),
    );
    expect(completed.data.map((trip: { id: string }) => trip.id)).toEqual([older.id]);
  });
});

describe("the driver's ledger", () => {
  it("records payouts and adjustments, and the database keeps the balance", async () => {
    const { agent, staff } = await signedInStaff();
    const driver = await addDriver(agent);

    const adjustment = await agent.request(`/v1/staff/drivers/${driver.id}/transactions`, {
      method: "POST",
      json: { type: "ADJUSTMENT", amount: "750.50", note: "Opening balance" },
    });
    expect(adjustment.status).toBe(201);
    expect(await bodyOf<DriverTransactionRecorded>(adjustment)).toMatchObject({
      transaction: {
        type: "ADJUSTMENT",
        amount: "750.50",
        note: "Opening balance",
        trip: null,
        staff: { id: staff.id },
      },
      amountOwed: "750.50",
    });

    const payout = await agent.request(`/v1/staff/drivers/${driver.id}/transactions`, {
      method: "POST",
      json: { type: "PAYOUT", amount: "500" },
    });
    expect(payout.status).toBe(201);
    expect(await bodyOf<DriverTransactionRecorded>(payout)).toMatchObject({
      transaction: { type: "PAYOUT", amount: "-500.00", note: null },
      amountOwed: "250.50",
    });

    await agent.request(`/v1/staff/drivers/${driver.id}/transactions`, {
      method: "POST",
      json: { type: "ADJUSTMENT", amount: "-300", note: "Cash kept from a trip" },
    });

    const stored = await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } });
    expect(stored.amountOwed.toFixed(2)).toBe("-49.50");
    expect(
      (await bodyOf<Driver>(await agent.request(`/v1/staff/drivers/${driver.id}`))).amountOwed,
    ).toBe("-49.50");

    const ledger = await bodyOf<Page<DriverTransaction>>(
      await agent.request(`/v1/staff/drivers/${driver.id}/transactions?limit=2`),
    );
    expect(ledger.data.map((entry: { amount: string }) => entry.amount)).toEqual([
      "-300.00",
      "-500.00",
    ]);
    expect(ledger.nextCursor).not.toBeNull();

    const logs = await prisma.auditLog.count({
      where: { entityId: driver.id, action: "fleet.driver.transaction_recorded" },
    });
    expect(logs).toBe(3);
  });

  it("records cash handed in as raising the balance, and sums the ledger", async () => {
    const { agent } = await signedInStaff();
    const driver = await addDriver(agent);
    const record = (json: object) =>
      agent.request(`/v1/staff/drivers/${driver.id}/transactions`, { method: "POST", json });

    await record({ type: "ADJUSTMENT", amount: "-1000", note: "Cash kept from a trip" });
    const handedIn = await record({ type: "CASH_HANDED_IN", amount: "600", note: "At the office" });
    expect(handedIn.status).toBe(201);
    expect(await bodyOf<DriverTransactionRecorded>(handedIn)).toMatchObject({
      transaction: { type: "CASH_HANDED_IN", amount: "600.00", note: "At the office" },
      amountOwed: "-400.00",
    });
    await record({ type: "PAYOUT", amount: "50" });

    const summary = await agent.request(`/v1/staff/drivers/${driver.id}/summary`);
    expect(summary.status).toBe(200);
    expect(await bodyOf<DriverSummary>(summary)).toEqual({
      totals: {
        cashCollected: "0.00",
        earned: "0.00",
        paidOut: "50.00",
        handedIn: "600.00",
        adjustments: "-1000.00",
      },
      thisMonth: { tripsCompleted: 0, kilometres: 0, fees: "0.00" },
    });
    expect((await agent.request("/v1/staff/drivers/missing/summary")).status).toBe(404);
  });

  it("refuses other types, a payout that isn't positive and an adjustment without a note", async () => {
    const { agent } = await signedInStaff();
    const driver = await addDriver(agent);
    for (const json of [
      { type: "TRIP_FEE", amount: "100" },
      { type: "PAYOUT", amount: "-100" },
      { type: "PAYOUT", amount: "0" },
      { type: "PAYOUT", amount: "12.345" },
      { type: "CASH_HANDED_IN", amount: "-5" },
      { type: "ADJUSTMENT", amount: "100" },
      { type: "ADJUSTMENT", amount: "0", note: "Nothing" },
    ]) {
      const response = await agent.request(`/v1/staff/drivers/${driver.id}/transactions`, {
        method: "POST",
        json,
      });
      expect(response.status, JSON.stringify(json)).toBe(400);
    }
    expect(await prisma.driverTransaction.count()).toBe(0);
  });

  it("is managed with the fleet permission only", async () => {
    const { agent: fleet } = await signedInStaff(["fleet"]);
    const driver = await addDriver(fleet);
    const { agent: trips } = await signedInStaff(["trips"]);

    expect((await trips.request(`/v1/staff/drivers/${driver.id}/transactions`)).status).toBe(403);
    const post = await trips.request(`/v1/staff/drivers/${driver.id}/transactions`, {
      method: "POST",
      json: { type: "PAYOUT", amount: "10" },
    });
    expect(post.status).toBe(403);
  });
});
