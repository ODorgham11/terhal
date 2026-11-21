import type { Analytics } from "@terhal/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../src/platform/db/prisma";
import { resetDatabase } from "../../support/database";
import { analyticsTrip } from "../../support/analytics";
import { governorate, place } from "../../support/fleet";
import { resetRedis } from "../../support/redis";
import { signedInStaff } from "../../support/staff-agents";
import { fleet } from "../../support/trips";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

const figures = async (
  agent: Awaited<ReturnType<typeof signedInStaff>>["agent"],
  query: string,
) => {
  const response = await agent.request(`/v1/staff/analytics?${query}`);
  expect(response.status).toBe(200);
  return (await response.json()) as Analytics;
};

// November 2026 in Cairo (UTC+2 all month): from 2026-10-31T22:00Z to 2026-11-30T22:00Z.
const november = async () => {
  const cairo = await governorate("Cairo", "القاهرة");
  const alexandria = await governorate("Alexandria", "الإسكندرية");
  const maadi = await place(cairo.id, "DISTRICT", "Maadi", 29.97, 31.26);
  const office = await prisma.office.create({
    data: { name: "Delta Cars", contact: "Hany", phone: "+201000000001", address: "Tanta" },
  });
  const { driver, vehicle } = await fleet();

  // 00:30 on 1 November in Cairo, though still 31 October in UTC: in the range.
  const first = await analyticsTrip({
    status: "COMPLETED",
    pickupDate: "2026-10-31T22:30:00Z",
    totalPrice: "1000.00",
    source: "CUSTOMER",
    pickupId: maadi.id,
    dropoffId: alexandria.id,
    officeId: office.id,
    paid: true,
    expenses: [
      { type: "FUEL", amount: "100.00" },
      { type: "OFFICE_FEE", amount: "300.00" },
    ],
  });
  // 23:59 on 30 November in Cairo: the last minute of the range.
  const last = await analyticsTrip({
    status: "COMPLETED",
    pickupDate: "2026-11-30T21:59:00Z",
    totalPrice: "500.00",
    pickupId: cairo.id,
    dropoffId: alexandria.id,
    driverId: driver.id,
    vehicleId: vehicle.id,
    car: "SUV",
    expenses: [{ type: "INTERCITY_TOLL", amount: "50.50" }],
  });
  await analyticsTrip({
    status: "CANCELLED",
    pickupDate: "2026-11-15T10:00:00Z",
    totalPrice: "700.00",
    pickupId: cairo.id,
    dropoffId: cairo.id,
  });
  await analyticsTrip({
    status: "CONFIRMED",
    pickupDate: "2026-11-20T10:00:00Z",
    totalPrice: "800.00",
    pickupId: cairo.id,
    dropoffId: cairo.id,
    driverId: driver.id,
    vehicleId: vehicle.id,
  });
  // 23:59 on 31 October and 00:00 on 1 December in Cairo: outside.
  for (const pickupDate of ["2026-10-31T21:59:00Z", "2026-11-30T22:00:00Z"]) {
    await analyticsTrip({
      status: "COMPLETED",
      pickupDate,
      totalPrice: "999.00",
      expenses: [{ type: "FUEL", amount: "999.00" }],
    });
  }
  return { cairo, alexandria, maadi, office, driver, vehicle, first, last };
};

describe("the analytics figures", () => {
  it("counts revenue from completed trips and costs from their reports, by Cairo days", async () => {
    const { agent } = await signedInStaff(["analytics"]);
    await november();

    const result = await figures(agent, "from=2026-11-01&to=2026-11-30&groupBy=month");
    expect(result.totals).toEqual({
      trips: 4,
      byStatus: {
        PENDING: 0,
        CANCELLED: 1,
        CONFIRMED: 1,
        IN_PROGRESS: 0,
        AWAITING_REPORT: 0,
        COMPLETED: 2,
      },
      completed: 2,
      cancelled: 1,
      cancellationRate: 0.25,
      revenue: "1500.00",
      bookedValue: "2300.00",
      averageFare: "750.00",
      expenses: "450.50",
      officeFees: "300.00",
      margin: "1049.50",
      unpaid: { trips: 1, amount: "500.00" },
    });
    expect(result.trend).toEqual([
      {
        period: "2026-11-01",
        trips: 4,
        completed: 2,
        cancelled: 1,
        revenue: "1500.00",
        bookedValue: "2300.00",
        expenses: "450.50",
        margin: "1049.50",
      },
    ]);
    expect(result.costs.byType).toContainEqual({ type: "OFFICE_FEE", amount: "300.00" });
    expect(result.costs.byType).toContainEqual({ type: "CAR_MAINTENANCE", amount: "0.00" });
    expect(result.costs.total).toBe("450.50");
  });

  it("buckets the trend by Cairo day and by Saturday weeks, empty buckets included", async () => {
    const { agent } = await signedInStaff(["analytics"]);
    await november();

    const daily = await figures(agent, "from=2026-11-01&to=2026-11-30");
    expect(daily.groupBy).toBe("day");
    expect(daily.trend).toHaveLength(30);
    expect(daily.trend[0]).toMatchObject({
      period: "2026-11-01",
      trips: 1,
      revenue: "1000.00",
      expenses: "400.00",
      margin: "600.00",
    });
    expect(daily.trend[1]).toMatchObject({ period: "2026-11-02", trips: 0, revenue: "0.00" });
    expect(daily.trend[29]).toMatchObject({ period: "2026-11-30", trips: 1, revenue: "500.00" });

    // 1 November 2026 is a Sunday, so its week starts on Saturday 31 October.
    const weekly = await figures(agent, "from=2026-11-01&to=2026-11-30&groupBy=week");
    expect(weekly.trend.map((bucket) => bucket.period)).toEqual([
      "2026-10-31",
      "2026-11-07",
      "2026-11-14",
      "2026-11-21",
      "2026-11-28",
    ]);
    expect(weekly.trend[0]).toMatchObject({ trips: 1, revenue: "1000.00" });
    // 15 November (cancelled) and 20 November (confirmed).
    expect(weekly.trend[2]).toMatchObject({ trips: 2, cancelled: 1 });

    // A single day: only that Cairo day's trips.
    const one = await figures(agent, "from=2026-11-01&to=2026-11-01");
    expect(one.totals).toMatchObject({ trips: 1, revenue: "1000.00" });
  });

  it("breaks trips down by class, body, source, governorate pair and fleet", async () => {
    const { agent } = await signedInStaff(["analytics"]);
    const { cairo, alexandria, driver, vehicle } = await november();

    const result = await figures(agent, "from=2026-11-01&to=2026-11-30");
    const economy = await prisma.tripClass.findFirstOrThrow();
    expect(result.byClass).toEqual([
      {
        classId: economy.id,
        nameEn: economy.nameEn,
        nameAr: economy.nameAr,
        trips: 3,
        completed: 2,
        revenue: "1500.00",
      },
    ]);
    expect(result.byCar).toEqual([
      { car: "SEDAN", trips: 2, completed: 1, revenue: "1000.00" },
      { car: "SUV", trips: 1, completed: 1, revenue: "500.00" },
    ]);
    expect(result.bySource).toEqual([
      { source: "CUSTOMER", trips: 1, completed: 1, revenue: "1000.00" },
      { source: "STAFF", trips: 2, completed: 1, revenue: "500.00" },
    ]);
    // Maadi sits in Cairo, so its trip counts as Cairo → Alexandria.
    expect(result.topRoutes).toEqual([
      {
        from: { id: cairo.id, nameEn: "Cairo", nameAr: "القاهرة" },
        to: { id: alexandria.id, nameEn: "Alexandria", nameAr: "الإسكندرية" },
        trips: 2,
        completed: 2,
        revenue: "1500.00",
      },
      {
        from: { id: cairo.id, nameEn: "Cairo", nameAr: "القاهرة" },
        to: { id: cairo.id, nameEn: "Cairo", nameAr: "القاهرة" },
        trips: 1,
        completed: 0,
        revenue: "0.00",
      },
    ]);
    expect(result.fleet).toEqual({
      inHouse: { trips: 2, completed: 1, revenue: "500.00" },
      office: { trips: 1, completed: 1, revenue: "1000.00" },
      byDriver: [
        {
          driverId: driver.id,
          name: `${driver.firstName} ${driver.lastName}`,
          trips: 2,
          completed: 1,
          revenue: "500.00",
        },
      ],
      byVehicle: [
        {
          vehicleId: vehicle.id,
          plateNumber: vehicle.plateNumber,
          trips: 2,
          completed: 1,
          revenue: "500.00",
        },
      ],
    });
  });

  it("reports what drivers are owed and hold now, and zeros for an empty range", async () => {
    const { agent } = await signedInStaff(["analytics"]);
    const owed = await fleet();
    const holding = await fleet();
    await fleet();
    await prisma.driverTransaction.createMany({
      data: [
        { driverId: owed.driver.id, type: "ADJUSTMENT", amount: "250.00", note: "Bonus" },
        { driverId: holding.driver.id, type: "ADJUSTMENT", amount: "-100.50", note: "Cash" },
      ],
    });

    const result = await figures(agent, "from=2020-01-01&to=2020-01-31&groupBy=week");
    expect(result.driverBalances).toEqual({
      owedToDrivers: "250.00",
      heldByDrivers: "100.50",
      drivers: 2,
    });
    expect(result.totals).toMatchObject({
      trips: 0,
      revenue: "0.00",
      averageFare: null,
      cancellationRate: 0,
      margin: "0.00",
    });
    expect(result.byClass).toEqual([]);
    expect(result.topRoutes).toEqual([]);
    // 1 January 2020 was a Wednesday: its week starts on Saturday 28 December.
    expect(result.trend[0]?.period).toBe("2019-12-28");
  });

  it("checks the range", async () => {
    const { agent } = await signedInStaff(["analytics"]);
    for (const query of [
      "from=2026-11-02&to=2026-11-01",
      "from=2026-11-01",
      "from=01/11/2026&to=2026-11-30",
      "from=2020-01-01&to=2026-01-01",
      "from=2026-11-01&to=2026-11-30&groupBy=year",
    ]) {
      const response = await agent.request(`/v1/staff/analytics?${query}`);
      expect(response.status, query).toBe(400);
    }
  });

  it("needs `analytics`", async () => {
    const { agent: trips } = await signedInStaff(["trips"]);
    const response = await trips.request("/v1/staff/analytics?from=2026-11-01&to=2026-11-30");
    expect(response.status).toBe(403);
  });
});
