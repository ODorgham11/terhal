import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../src/platform/db/prisma";
import { resetDatabase } from "../../support/database";
import { resetRedis } from "../../support/redis";
import {
  bookedTrip,
  events,
  fleet,
  json,
  pickupIn,
  signedInCustomer,
  tripWorld,
  tripsStaff,
  type Agent,
  type TripBody,
  type TripWorld,
} from "../../support/trips";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

const problem = (response: Response) =>
  json<{ code: string; conflicts?: { id: string }[]; tripStatus?: string }>(response);

let world: TripWorld;
let staff: Agent;
let site: Agent;

beforeEach(async () => {
  world = await tripWorld();
  staff = (await tripsStaff(["trips", "fleet"])).agent;
  site = (await signedInCustomer()).agent;
});

const assign = (id: string, body: unknown) =>
  staff.request(`/v1/staff/trips/${id}/assignment`, { method: "PUT", json: body });

const office = (name = "Partner") =>
  prisma.office.create({
    data: { name, contact: "Ali", phone: "+201000000009", address: "Cairo" },
  });

describe("assignment", () => {
  it("assigns a driver and a vehicle, records it, and clears it", async () => {
    const { trip } = await bookedTrip(site, world);
    const { driver, vehicle } = await fleet();
    const response = await assign(trip.id, { driverId: driver.id, vehicleId: vehicle.id });
    expect(response.status).toBe(200);
    expect(await json<TripBody>(response)).toMatchObject({
      driver: { id: driver.id },
      vehicle: { id: vehicle.id, body: "SEDAN" },
    });
    expect((await events(trip.id)).at(-1)).toMatchObject({
      action: "trip.assigned",
      data: {
        changes: {
          driverId: { before: null, after: driver.id },
          vehicleId: { before: null, after: vehicle.id },
        },
      },
    });

    await assign(trip.id, {});
    expect((await events(trip.id)).at(-1)?.action).toBe("trip.unassigned");
  });

  it("allows a bigger vehicle and refuses a smaller one", async () => {
    const { trip } = await bookedTrip(site, world, {
      car: "SUV",
      classId: world.vip.id,
      expectedPrice: undefined,
    });
    const van = await fleet({ body: "VAN" });
    expect((await assign(trip.id, { vehicleId: van.vehicle.id })).status).toBe(200);
    const sedan = await fleet({ body: "SEDAN" });
    const refused = await assign(trip.id, { vehicleId: sedan.vehicle.id });
    expect(refused.status).toBe(422);
    expect((await problem(refused)).code).toBe("VEHICLE_TOO_SMALL");
  });

  it("flags a driver or vehicle with another live trip within 3 hours, unless acknowledged", async () => {
    const { trip } = await bookedTrip(site, world);
    const { trip: near } = await bookedTrip(site, world, {
      pickupDate: new Date(new Date(trip.pickupDate).getTime() + 2.75 * 3600_000).toISOString(),
    });
    const { trip: far } = await bookedTrip(site, world, {
      pickupDate: new Date(new Date(trip.pickupDate).getTime() + 3.25 * 3600_000).toISOString(),
    });
    const { driver, vehicle } = await fleet();
    await prisma.trip.update({ where: { id: near.id }, data: { driverId: driver.id } });
    await prisma.trip.update({ where: { id: far.id }, data: { vehicleId: vehicle.id } });

    const flagged = await assign(trip.id, { driverId: driver.id, vehicleId: vehicle.id });
    expect(flagged.status).toBe(409);
    expect(await problem(flagged)).toMatchObject({
      code: "ASSIGNMENT_CONFLICT",
      conflicts: [{ id: near.id }],
    });

    const acknowledged = await assign(trip.id, {
      driverId: driver.id,
      vehicleId: vehicle.id,
      acknowledgeConflicts: true,
    });
    expect(acknowledged.status).toBe(200);
    expect((await events(trip.id)).at(-1)?.data).toMatchObject({
      acknowledgedConflicts: [near.id],
    });

    // A cancelled trip doesn't count.
    await prisma.trip.update({ where: { id: near.id }, data: { status: "CANCELLED" } });
    const other = await fleet();
    await prisma.trip.update({ where: { id: near.id }, data: { driverId: other.driver.id } });
    expect((await assign(trip.id, { driverId: other.driver.id })).status).toBe(200);
  });

  it("hands a trip to an office, with only the office's driver and vehicle", async () => {
    const { trip } = await bookedTrip(site, world);
    const partner = await office();
    const theirs = await fleet({ officeId: partner.id });
    const ours = await fleet();

    expect((await assign(trip.id, { officeId: partner.id })).status).toBe(200);
    const mismatch = await assign(trip.id, { officeId: partner.id, driverId: ours.driver.id });
    expect(mismatch.status).toBe(422);
    expect((await problem(mismatch)).code).toBe("ASSIGNMENT_OFFICE_MISMATCH");
    expect(
      (
        await assign(trip.id, {
          officeId: partner.id,
          driverId: theirs.driver.id,
          vehicleId: theirs.vehicle.id,
        })
      ).status,
    ).toBe(200);

    // The site says a partner runs it once it's confirmed.
    await prisma.trip.update({ where: { id: trip.id }, data: { status: "CONFIRMED" } });
    const seen = await json<TripBody>(await site.request(`/v1/site/trips/${trip.id}`));
    expect(seen.assignment).toMatchObject({
      partner: true,
      driver: { firstName: theirs.driver.firstName },
    });
  });

  it("refuses archived or unknown drivers, vehicles and offices", async () => {
    const { trip } = await bookedTrip(site, world);
    const { driver, vehicle } = await fleet();
    const partner = await office();
    await prisma.driver.update({ where: { id: driver.id }, data: { archivedAt: new Date() } });
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { archivedAt: new Date() } });
    await prisma.office.update({ where: { id: partner.id }, data: { archivedAt: new Date() } });

    expect((await problem(await assign(trip.id, { driverId: driver.id }))).code).toBe(
      "DRIVER_NOT_AVAILABLE",
    );
    expect((await problem(await assign(trip.id, { vehicleId: vehicle.id }))).code).toBe(
      "VEHICLE_NOT_AVAILABLE",
    );
    expect((await problem(await assign(trip.id, { officeId: partner.id }))).code).toBe(
      "OFFICE_NOT_AVAILABLE",
    );
    expect((await problem(await assign(trip.id, { driverId: "nope" }))).code).toBe(
      "DRIVER_NOT_AVAILABLE",
    );
  });

  it("only while pending or confirmed", async () => {
    const { trip } = await bookedTrip(site, world);
    const { driver } = await fleet();
    await prisma.trip.update({ where: { id: trip.id }, data: { status: "AWAITING_REPORT" } });
    const response = await assign(trip.id, { driverId: driver.id });
    expect(response.status).toBe(409);
    expect(await problem(response)).toMatchObject({
      code: "TRIP_STATUS_CONFLICT",
      tripStatus: "AWAITING_REPORT",
    });
  });

  it("replaces the report link when the driver changes, and drops it when the driver goes", async () => {
    const { trip } = await bookedTrip(site, world);
    const first = await fleet();
    const second = await fleet();
    await prisma.trip.update({
      where: { id: trip.id },
      data: {
        driverId: first.driver.id,
        reportTokenHash: "hash",
        reportTokenSalt: "salt",
        reportTokenExpiresAt: pickupIn(200),
      },
    });
    await assign(trip.id, { driverId: second.driver.id });
    const reassigned = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    expect(reassigned.reportTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(reassigned.reportTokenSalt).not.toBe("salt");
    // Seven days after the pickup.
    expect(reassigned.reportTokenExpiresAt?.getTime()).toBe(
      reassigned.pickupDate.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
    // The secret never reaches the history.
    expect(JSON.stringify((await events(trip.id)).at(-1)?.data)).not.toMatch(/hash|salt/);

    await assign(trip.id, { vehicleId: second.vehicle.id });
    expect(await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).toMatchObject({
      reportTokenHash: null,
      reportTokenSalt: null,
      reportTokenExpiresAt: null,
    });
  });

  it("never lets an assignment and an archive both win", async () => {
    for (let round = 0; round < 5; round += 1) {
      const { trip } = await bookedTrip(site, world);
      const { driver } = await fleet();
      const [assigned, archived] = await Promise.all([
        assign(trip.id, { driverId: driver.id }),
        staff.request(`/v1/staff/drivers/${driver.id}/archive`, { method: "POST" }),
      ]);
      const after = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
      const stored = await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } });
      if (assigned.status === 200) {
        expect(archived.status).toBe(409);
        expect(stored.archivedAt).toBeNull();
        expect(after.driverId).toBe(driver.id);
      } else {
        expect(archived.status).toBe(200);
        expect((await problem(assigned)).code).toBe("DRIVER_NOT_AVAILABLE");
        expect(after.driverId).toBeNull();
      }
      await prisma.trip.update({ where: { id: trip.id }, data: { status: "CANCELLED" } });
    }
  });

  it("lists candidates with their clashes and the vehicles that fit", async () => {
    const { trip } = await bookedTrip(site, world, {
      car: "SUV",
      classId: world.vip.id,
      expectedPrice: undefined,
    });
    const { trip: near } = await bookedTrip(site, world, {
      pickupDate: new Date(new Date(trip.pickupDate).getTime() + 3600_000).toISOString(),
    });
    const busy = await fleet({ body: "MINIVAN" });
    const small = await fleet({ body: "SEDAN" });
    await prisma.trip.update({
      where: { id: near.id },
      data: { driverId: busy.driver.id, vehicleId: busy.vehicle.id },
    });

    const response = await staff.request(`/v1/staff/trips/${trip.id}/assignment/candidates`);
    expect(response.status).toBe(200);
    const body = await json<{
      drivers: { id: string; conflicts: { id: string }[] }[];
      vehicles: { id: string; conflicts: { id: string }[] }[];
    }>(response);
    expect(body.drivers.find((d) => d.id === busy.driver.id)?.conflicts).toMatchObject([
      { id: near.id },
    ]);
    expect(body.drivers.find((d) => d.id === small.driver.id)?.conflicts).toEqual([]);
    expect(body.vehicles.map((v) => v.id)).toEqual([busy.vehicle.id]);
    expect(body.vehicles[0]?.conflicts).toMatchObject([{ id: near.id }]);
  });
});

describe("linking trips", () => {
  const link = (id: string, returnTripId: string) =>
    staff.request(`/v1/staff/trips/${id}/link`, { method: "POST", json: { returnTripId } });
  const unlink = (id: string) => staff.request(`/v1/staff/trips/${id}/link`, { method: "DELETE" });

  it("links two trips and unlinks them, with events on both", async () => {
    const { trip } = await bookedTrip(site, world);
    const { trip: back } = await bookedTrip(site, world, {
      pickupDate: pickupIn(72).toISOString(),
    });

    const linked = await link(trip.id, back.id);
    expect(linked.status).toBe(200);
    expect(await json<TripBody>(linked)).toMatchObject({ returnTripId: back.id });
    expect((await events(back.id)).at(-1)).toMatchObject({
      action: "trip.linked",
      data: { changes: { previousTripId: { before: null, after: trip.id } } },
    });
    expect((await events(trip.id)).at(-1)).toMatchObject({
      action: "trip.linked",
      data: { returnTripId: back.id },
    });

    const third = await bookedTrip(site, world, { pickupDate: pickupIn(96).toISOString() });
    expect((await problem(await link(back.id, third.trip.id))).code).toBe("TRIP_ALREADY_LINKED");

    expect((await unlink(back.id)).status).toBe(200);
    expect((await events(trip.id)).at(-1)?.action).toBe("trip.unlinked");
    expect(
      (await prisma.trip.findUniqueOrThrow({ where: { id: back.id } })).previousTripId,
    ).toBeNull();
    expect((await problem(await unlink(trip.id))).code).toBe("TRIP_NOT_LINKED");
  });

  it("refuses a return that picks up first, or a trip linked to itself", async () => {
    const { trip } = await bookedTrip(site, world, { pickupDate: pickupIn(72).toISOString() });
    const { trip: earlier } = await bookedTrip(site, world);
    expect((await problem(await link(trip.id, earlier.id))).code).toBe("TRIP_LINK_INVALID");
    expect((await problem(await link(trip.id, trip.id))).code).toBe("TRIP_LINK_INVALID");
    expect((await link(trip.id, "missing")).status).toBe(404);
  });
});
