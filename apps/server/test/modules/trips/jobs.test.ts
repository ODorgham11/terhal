import { beforeEach, describe, expect, it } from "vitest";
import {
  advanceOverdueTrips,
  expirePendingTrips,
} from "../../../src/modules/trips/application/jobs";
import { processTripJob } from "../../../src/modules/trips/index";
import { prisma } from "../../../src/platform/db/prisma";
import { resetDatabase } from "../../support/database";
import { resetRedis } from "../../support/redis";
import { createTrip } from "../../support/fleet";
import { events, fleet } from "../../support/trips";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

const HOUR = 60 * 60 * 1000;

const statusOf = async (id: string) =>
  (await prisma.trip.findUniqueOrThrow({ where: { id } })).status;

describe("expire-pending-trips", () => {
  it("cancels pending trips at their pickup time, once, as the system", async () => {
    const now = new Date();
    const due = await createTrip({ status: "PENDING", pickupDate: new Date(now.getTime() - 1000) });
    const unpriced = await createTrip({
      status: "PENDING",
      pickupDate: new Date(now.getTime() - HOUR),
    });
    await prisma.trip.update({
      where: { id: unpriced.id },
      data: {
        totalPrice: null,
        priceState: "REQUESTED",
        createdAt: new Date(now.getTime() - 5 * HOUR),
      },
    });
    await prisma.trip.update({
      where: { id: due.id },
      data: { createdAt: new Date(now.getTime() - 5 * HOUR) },
    });
    const later = await createTrip({
      status: "PENDING",
      pickupDate: new Date(now.getTime() + HOUR),
    });
    const confirmed = await createTrip({
      status: "CONFIRMED",
      pickupDate: new Date(now.getTime() - HOUR),
    });
    // Booked after its pickup time (backdated by staff): left alone.
    const backdated = await createTrip({
      status: "PENDING",
      pickupDate: new Date(now.getTime() - 2 * HOUR),
    });

    expect(await expirePendingTrips(now)).toBe(2);
    expect(await statusOf(due.id)).toBe("CANCELLED");
    expect(await statusOf(unpriced.id)).toBe("CANCELLED");
    expect(await statusOf(later.id)).toBe("PENDING");
    expect(await statusOf(confirmed.id)).toBe("CONFIRMED");
    expect(await statusOf(backdated.id)).toBe("PENDING");

    expect(await events(due.id)).toMatchObject([
      {
        action: "trip.cancelled",
        system: "expire-pending-trips",
        data: { from: "PENDING", to: "CANCELLED", reason: "NOT_CONFIRMED" },
      },
    ]);
    expect((await events(unpriced.id))[0]?.data).toMatchObject({ reason: "PRICE_NOT_SETTLED" });

    // Idempotent: running again (or a retry) changes nothing.
    expect(await expirePendingTrips(now)).toBe(0);
    expect(await events(due.id)).toHaveLength(1);
  });
});

describe("advance-overdue-trips", () => {
  it("moves assigned trips not ended 12 hours after pickup to awaiting report", async () => {
    const now = new Date();
    const { driver, vehicle } = await fleet();
    const spare = await fleet();
    const office = await prisma.office.create({
      data: { name: "Partner", contact: "Ali", phone: "+201000000009", address: "Cairo" },
    });
    const old = new Date(now.getTime() - 13 * HOUR);

    const started = await createTrip({
      status: "IN_PROGRESS",
      pickupDate: old,
      driverId: driver.id,
      vehicleId: vehicle.id,
    });
    const confirmed = await createTrip({
      status: "CONFIRMED",
      pickupDate: old,
      driverId: spare.driver.id,
      vehicleId: spare.vehicle.id,
    });
    const handedOff = await createTrip({
      status: "CONFIRMED",
      pickupDate: old,
      officeId: office.id,
    });
    const unassigned = await createTrip({ status: "CONFIRMED", pickupDate: old });
    const recent = await createTrip({
      status: "CONFIRMED",
      pickupDate: new Date(now.getTime() - 11 * HOUR),
      officeId: office.id,
    });

    expect(await advanceOverdueTrips(now)).toBe(3);
    for (const trip of [started, confirmed, handedOff]) {
      expect(await statusOf(trip.id)).toBe("AWAITING_REPORT");
    }
    expect(await statusOf(unassigned.id)).toBe("CONFIRMED");
    expect(await statusOf(recent.id)).toBe("CONFIRMED");
    expect(await events(started.id)).toMatchObject([
      {
        action: "trip.ended",
        system: "advance-overdue-trips",
        data: { from: "IN_PROGRESS", to: "AWAITING_REPORT", reason: "OVERDUE" },
      },
    ]);

    expect(await advanceOverdueTrips(now)).toBe(0);
  });

  it("runs through the worker's processor by job name", async () => {
    const trip = await createTrip({
      status: "PENDING",
      pickupDate: new Date(Date.now() - 1000),
    });
    await prisma.trip.update({
      where: { id: trip.id },
      data: { createdAt: new Date(Date.now() - HOUR) },
    });
    await processTripJob({ name: "expire-pending-trips" } as Parameters<typeof processTripJob>[0]);
    expect(await statusOf(trip.id)).toBe("CANCELLED");
    await expect(
      processTripJob({ name: "unknown" } as Parameters<typeof processTripJob>[0]),
    ).rejects.toThrow();
  });
});
