import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma";
import { resetDatabase } from "../support/database";

// The "exactly one of" rules Prisma can't express, held by check constraints in the migrations.

beforeEach(async () => {
  await resetDatabase();
});

const people = async () => {
  const customer = await prisma.customer.create({
    data: {
      firstName: "Mona",
      lastName: "Customer",
      phone: "+201000000001",
      email: "customer@terhal.co",
      passwordHash: "x",
    },
  });
  const guest = await prisma.guestSession.create({
    data: {
      firstName: "Omar",
      lastName: "Guest",
      phone: "+201000000002",
      email: "guest@terhal.co",
      tokenHash: "guest-token",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const staff = await prisma.staff.create({
    data: {
      firstName: "Sara",
      lastName: "Staff",
      email: "staff@terhal.co",
      passwordHash: "x",
      permissions: [],
    },
  });
  return { customer, guest, staff };
};

const tripData = async () => {
  const [location, tripClass] = await Promise.all([
    prisma.location.create({
      data: { locality: "GOVERNORATE", nameEn: "Cairo", nameAr: "القاهرة" },
    }),
    prisma.tripClass.create({ data: { nameEn: "Economy", nameAr: "اقتصادي" } }),
  ]);
  let code = 0;
  return () => ({
    code: `T-${++code}`,
    source: "STAFF" as const,
    classId: tripClass.id,
    classSnapshot: { nameEn: "Economy", nameAr: "اقتصادي" },
    clientName: "Client",
    clientPhone: "+201000000003",
    pickupDate: new Date(),
    smallLuggage: 0,
    mediumLuggage: 0,
    largeLuggage: 0,
    passengers: 1,
    car: "SEDAN" as const,
    totalPrice: "100.00",
    pickupId: location.id,
    pickupSnapshot: "Cairo",
    pickupLatitude: "30.044420",
    pickupLongitude: "31.235712",
    dropoffId: location.id,
    dropoffSnapshot: "Cairo",
    dropoffLatitude: "30.044420",
    dropoffLongitude: "31.235712",
  });
};

describe("a trip", () => {
  it("is booked by exactly one of a customer, a guest and a staff member", async () => {
    const { customer, guest, staff } = await people();
    const trip = await tripData();

    for (const booker of [
      { customerId: customer.id },
      { guestSessionId: guest.id },
      { staffId: staff.id },
    ]) {
      await expect(prisma.trip.create({ data: { ...trip(), ...booker } })).resolves.toBeDefined();
    }
    await expect(prisma.trip.create({ data: trip() })).rejects.toThrow(/Trip_one_booker/);
    await expect(
      prisma.trip.create({ data: { ...trip(), customerId: customer.id, staffId: staff.id } }),
    ).rejects.toThrow(/Trip_one_booker/);
  });
});

describe("a notification", () => {
  it("goes to exactly one of a customer, a guest and a staff member", async () => {
    const { customer, guest, staff } = await people();
    const message = { title: "Trip confirmed", body: "See you soon." };

    for (const recipient of [
      { customerId: customer.id },
      { guestSessionId: guest.id },
      { staffId: staff.id },
    ]) {
      await expect(
        prisma.notification.create({ data: { ...message, ...recipient } }),
      ).resolves.toBeDefined();
    }
    await expect(prisma.notification.create({ data: message })).rejects.toThrow(
      /Notification_one_recipient/,
    );
    await expect(
      prisma.notification.create({
        data: { ...message, guestSessionId: guest.id, staffId: staff.id },
      }),
    ).rejects.toThrow(/Notification_one_recipient/);
  });
});

describe("a trip event", () => {
  it("is done by exactly one of a staff member, a customer, a guest and the system", async () => {
    const { customer, guest, staff } = await people();
    const { id: tripId } = await prisma.trip.create({
      data: { ...(await tripData())(), staffId: staff.id },
    });

    for (const actor of [
      { staffId: staff.id },
      { customerId: customer.id },
      { guestSessionId: guest.id },
      { system: "expire-pending-trips" },
    ]) {
      await expect(
        prisma.tripEvent.create({ data: { tripId, action: "trip.updated", ...actor } }),
      ).resolves.toBeDefined();
    }
    await expect(
      prisma.tripEvent.create({ data: { tripId, action: "trip.updated" } }),
    ).rejects.toThrow(/TripEvent_one_actor/);
    await expect(
      prisma.tripEvent.create({
        data: {
          tripId,
          action: "trip.updated",
          customerId: customer.id,
          system: "expire-pending-trips",
        },
      }),
    ).rejects.toThrow(/TripEvent_one_actor/);
  });
});

describe("a customer", () => {
  it("changes their email or their phone, one at a time", async () => {
    const { customer } = await people();

    await expect(
      prisma.customer.update({
        where: { id: customer.id },
        data: { pendingEmail: "new@terhal.co" },
      }),
    ).resolves.toBeDefined();
    await expect(
      prisma.customer.update({
        where: { id: customer.id },
        data: { pendingPhone: "+201000000009" },
      }),
    ).rejects.toThrow(/Customer_one_pending_change/);
  });
});
