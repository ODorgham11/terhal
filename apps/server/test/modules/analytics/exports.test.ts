import { TRIP_EXPORT_LIMIT, type Problem } from "@terhal/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../src/platform/db/prisma";
import { analyticsTrip } from "../../support/analytics";
import { resetDatabase } from "../../support/database";
import { resetRedis } from "../../support/redis";
import { signedInStaff } from "../../support/staff-agents";
import { fleet } from "../../support/trips";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

type Agent = Awaited<ReturnType<typeof signedInStaff>>["agent"];

// The file as Excel reads it: a byte order mark, then CRLF lines.
const download = async (agent: Agent, path: string) => {
  const response = await agent.request(path);
  expect(response.status, await response.clone().text()).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/csv; charset=UTF-8");
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer());
  expect(text.startsWith("﻿")).toBe(true);
  const lines = text.slice(1).split("\r\n");
  expect(lines.pop()).toBe("");
  return { response, lines };
};

describe("the trips CSV", () => {
  it("streams the filtered trips, oldest first, safe for spreadsheets and in Arabic", async () => {
    const { agent } = await signedInStaff(["trips"]);
    const { driver, vehicle } = await fleet();
    const later = await analyticsTrip({
      status: "COMPLETED",
      pickupDate: "2026-11-20T10:00:00Z",
      totalPrice: "1250.50",
      clientName: '=HYPERLINK("http://evil")',
      clientPhone: "+201000000009",
      driverId: driver.id,
      vehicleId: vehicle.id,
      expenses: [
        { type: "FUEL", amount: "100.25" },
        { type: "INTERCITY_TOLL", amount: "20.00" },
      ],
    });
    const earlier = await analyticsTrip({
      status: "CONFIRMED",
      pickupDate: "2026-11-01T08:00:00Z",
      clientName: "منى عادل",
    });
    await analyticsTrip({ status: "CANCELLED", pickupDate: "2026-11-02T08:00:00Z" });

    const { response, lines } = await download(
      agent,
      "/v1/staff/exports/trips.csv?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z",
    );
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="trips.csv"');
    expect(lines[0]?.split(",")).toEqual([
      "code",
      "status",
      "source",
      "pickupDate",
      "pickupCairo",
      "classEn",
      "classAr",
      "car",
      "passengers",
      "smallLuggage",
      "mediumLuggage",
      "largeLuggage",
      "clientName",
      "clientPhone",
      "bookedBy",
      "pickupEn",
      "pickupAr",
      "dropoffEn",
      "dropoffAr",
      "totalPrice",
      "priceState",
      "paymentMethod",
      "paidAt",
      "driver",
      "driverPhone",
      "vehicle",
      "office",
      "expenses",
      "isReturn",
      "createdAt",
    ]);
    expect(lines).toHaveLength(4);
    expect(
      lines[1]?.startsWith(
        `${earlier.code},CONFIRMED,STAFF,2026-11-01T08:00:00.000Z,2026-11-01 10:00,`,
      ),
    ).toBe(true);
    expect(lines[1]).toContain(",منى عادل,");
    const row = lines[3] ?? "";
    expect(row.startsWith(`${later.code},COMPLETED,`)).toBe(true);
    // A formula is kept as text, and so is a phone number's leading plus.
    expect(row).toContain(`,"'=HYPERLINK(""http://evil"")",'+201000000009,staff: Test Staff,`);
    expect(row).toContain(
      `,1250.50,QUOTED,,,${driver.firstName} ${driver.lastName},'${driver.phone},${vehicle.plateNumber},,120.25,false,`,
    );

    const filtered = await download(agent, "/v1/staff/exports/trips.csv?status=CANCELLED");
    expect(filtered.lines).toHaveLength(2);
    expect(filtered.lines[1]).toContain(",CANCELLED,");

    const searched = await download(
      agent,
      `/v1/staff/exports/trips.csv?q=${later.code.toLowerCase()}`,
    );
    expect(searched.lines).toHaveLength(2);
    expect(searched.lines[1]?.startsWith(later.code)).toBe(true);
  });

  it(`refuses more than ${String(TRIP_EXPORT_LIMIT)} trips before sending anything`, async () => {
    const { agent } = await signedInStaff(["analytics"]);
    const template = await analyticsTrip({ status: "PENDING", pickupDate: "2026-11-01T08:00:00Z" });
    // Copies of the trip with their own ids and codes, written in one statement.
    const columns = (
      await prisma.$queryRaw<{ name: string }[]>`
        SELECT column_name AS name FROM information_schema.columns
        WHERE table_name = 'Trip' AND column_name NOT IN ('id', 'code')`
    ).map(({ name }) => `"${name}"`);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Trip" ("id", "code", ${columns.join(", ")})
       SELECT 'copy-' || g, 'TRH-C' || g, ${columns.map((c) => `t.${c}`).join(", ")}
       FROM "Trip" t, generate_series(1, $1::int) g WHERE t.id = $2`,
      TRIP_EXPORT_LIMIT,
      template.id,
    );

    const response = await agent.request("/v1/staff/exports/trips.csv");
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "EXPORT_TOO_LARGE",
      count: TRIP_EXPORT_LIMIT + 1,
      limit: TRIP_EXPORT_LIMIT,
    } satisfies Partial<Problem> & Record<string, unknown>);

    await prisma.trip.update({ where: { id: template.id }, data: { status: "CANCELLED" } });
    const exactly = await agent.request("/v1/staff/exports/trips.csv?status=PENDING");
    expect(exactly.status).toBe(200);
    const text = await exactly.text();
    expect(text.split("\r\n")).toHaveLength(TRIP_EXPORT_LIMIT + 2);
  }, 120_000);

  it("needs `analytics` or `trips`", async () => {
    const { agent: fleetOnly } = await signedInStaff(["fleet"]);
    expect((await fleetOnly.request("/v1/staff/exports/trips.csv")).status).toBe(403);
    const { agent } = await signedInStaff(["analytics"]);
    expect((await agent.request("/v1/staff/exports/trips.csv")).status).toBe(200);
    const bad = await agent.request("/v1/staff/exports/trips.csv?from=yesterday");
    expect(bad.status).toBe(400);
  });
});

describe("the other CSVs", () => {
  it("exports drivers, vehicles, customers and prices", async () => {
    const { agent } = await signedInStaff(["analytics"]);
    const { driver, vehicle } = await fleet();
    await prisma.driverTransaction.create({
      data: { driverId: driver.id, type: "ADJUSTMENT", amount: "-40.00", note: "Cash" },
    });
    const customer = await prisma.customer.create({
      data: {
        firstName: "@Mona",
        lastName: "عادل",
        phone: "+201234567890",
        email: "mona@example.com",
        passwordHash: "x",
        status: "ACTIVE",
      },
    });
    await prisma.customer.create({
      data: {
        firstName: "Gone",
        lastName: "Away",
        phone: "+201234567891",
        email: "gone@example.com",
        passwordHash: "x",
        status: "DELETED",
      },
    });

    const drivers = await download(agent, "/v1/staff/exports/drivers.csv");
    expect(drivers.lines[0]).toBe(
      "id,firstName,lastName,phone,isExternal,office,licenseNumber,licenseExpiresAt,nationalId,amountOwed,archivedAt,createdAt",
    );
    expect(drivers.lines[1]).toContain(
      `${driver.id},${driver.firstName},Test,'${driver.phone},false,,,,,-40.00,,`,
    );

    const vehicles = await download(agent, "/v1/staff/exports/vehicles.csv");
    expect(vehicles.lines[1]).toContain(
      `${vehicle.id},Toyota,Corolla,,${vehicle.plateNumber},White,SEDAN,false,,,`,
    );

    const customers = await download(agent, "/v1/staff/exports/customers.csv");
    expect(customers.lines).toHaveLength(2);
    expect(customers.lines[1]).toContain(
      `${customer.id},'@Mona,عادل,'+201234567890,mona@example.com,ACTIVE,ar,,0,`,
    );

    const pricing = await download(agent, "/v1/staff/exports/pricing.csv");
    expect(pricing.lines[0]).toBe(
      "fromId,fromNameEn,fromNameAr,toId,toNameEn,toNameAr,classId,classNameEn,classNameAr,car,price,active",
    );
  });

  it("need `analytics`", async () => {
    const { agent } = await signedInStaff(["trips", "fleet", "customers", "pricing"]);
    for (const file of ["drivers", "vehicles", "customers", "pricing"]) {
      const response = await agent.request(`/v1/staff/exports/${file}.csv`);
      expect(response.status, file).toBe(403);
    }
  });
});
