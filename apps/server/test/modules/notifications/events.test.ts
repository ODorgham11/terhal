import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../src/platform/db/prisma";
import { resetDatabase } from "../../support/database";
import { resetRedis } from "../../support/redis";
import {
  act,
  bookedTrip,
  booking,
  book,
  fleet,
  json,
  pickupIn,
  signedInCustomer,
  staffBook,
  tripWorld,
  tripsStaff,
  verifiedGuest,
  type Agent,
  type Booked,
  type TripWorld,
} from "../../support/trips";

// Trip events through the API, and the notifications, deliveries and reminders they leave behind (N1, N4, N5).

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

const HOUR = 60 * 60 * 1000;

const notificationsOf = (tripId: string) =>
  prisma.notification.findMany({
    where: { tripId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { deliveries: true },
  });

const remindersOf = async (tripId: string) =>
  Object.fromEntries(
    (await prisma.notificationReminder.findMany({ where: { tripId } })).map((row) => [
      row.kind,
      row.dueAt?.toISOString() ?? null,
    ]),
  );

describe("notifications from trip events", () => {
  let world: TripWorld;
  let staff: Agent;
  let staffId: string;
  let otherStaffId: string;
  beforeEach(async () => {
    world = await tripWorld();
    const signedIn = await tripsStaff();
    staff = signedIn.agent;
    staffId = signedIn.staff.id;
    otherStaffId = (await tripsStaff(["trips"], "dispatcher@terhal.co")).staff.id;
    await prisma.staff.update({ where: { id: otherStaffId }, data: { locale: "en" } });
    // Without `trips`, nobody tells them of trips.
    await tripsStaff(["fleet"], "fleet@terhal.co");
  });

  it("emails a customer their booking in their language, and tells every trips staff member", async () => {
    const { customer, agent } = await signedInCustomer();
    await prisma.customer.update({ where: { id: customer.id }, data: { locale: "en" } });
    const { trip } = await bookedTrip(agent, world);

    const rows = await notificationsOf(trip.id);
    const email = rows.find((row) => row.customerId === customer.id);
    expect(email).toMatchObject({
      kind: "BOOKING_RECEIVED",
      locale: "en",
      title: `We received your booking ${trip.code}`,
    });
    expect(email?.deliveries).toEqual([
      expect.objectContaining({
        channel: "EMAIL",
        status: "PENDING",
        recipient: customer.email,
        attempts: 0,
        queuedAt: null,
      }),
    ]);

    const inApp = rows.filter((row) => row.staffId !== null);
    expect(inApp.map((row) => [row.staffId, row.kind, row.locale]).sort()).toEqual(
      [
        [staffId, "NEW_BOOKING", "ar"],
        [otherStaffId, "NEW_BOOKING", "en"],
      ].sort(),
    );
    expect(inApp.find((row) => row.locale === "ar")?.title).toBe(`حجز جديد ${trip.code}`);
    expect(inApp.every((row) => row.deliveries.length === 0)).toBe(true);
  });

  it("emails a guest, Arabic by default, and tells staff a price is requested", async () => {
    const { session, agent } = await verifiedGuest();
    const response = await book(
      agent,
      booking(world, { classId: world.vip.id, expectedPrice: undefined }),
    );
    expect(response.status).toBe(201);
    const { trip } = await json<Booked>(response);

    const rows = await notificationsOf(trip.id);
    expect(rows.find((row) => row.guestSessionId === session.id)).toMatchObject({
      kind: "BOOKING_RECEIVED",
      locale: "ar",
      title: `استلمنا حجزك ${trip.code}`,
    });
    expect(rows.filter((row) => row.staffId).map((row) => row.kind)).toEqual([
      "PRICE_REQUESTED",
      "PRICE_REQUESTED",
    ]);
  });

  it("emails a customer booked for by staff, and leaves the booking staff member out", async () => {
    const { customer } = await signedInCustomer();
    const response = await staffBook(staff, {
      ...booking(world),
      customerId: customer.id,
      expectedPrice: undefined,
    });
    expect(response.status).toBe(201);
    const { trip } = await json<Booked>(response);

    const rows = await notificationsOf(trip.id);
    expect(rows.map((row) => [row.kind, row.customerId ?? row.staffId])).toEqual([
      ["BOOKED_BY_STAFF", customer.id],
    ]);
  });

  it("tells no one of a staff member's own booking", async () => {
    const response = await staffBook(staff, {
      ...booking(world),
      clientName: "Walk In",
      clientPhone: "+201000000001",
      expectedPrice: undefined,
    });
    expect(response.status).toBe(201);
    const { trip } = await json<Booked>(response);
    expect(await notificationsOf(trip.id)).toEqual([]);
    expect(await remindersOf(trip.id)).toEqual({ UNASSIGNED: expect.any(String) as string });
  });

  it("sends the driver's details on confirmation and on reassignment (A6 a)", async () => {
    const { customer, agent } = await signedInCustomer();
    const { trip } = await bookedTrip(agent, world, { pickupDate: pickupIn(72).toISOString() });
    const first = await fleet();
    const second = await fleet();
    const assign = (driverId: string, vehicleId: string) =>
      staff.request(`/v1/staff/trips/${trip.id}/assignment`, {
        method: "PUT",
        json: { driverId, vehicleId },
      });

    // Pending: no email yet.
    expect((await assign(first.driver.id, first.vehicle.id)).status).toBe(200);
    expect((await act(staff, trip.id, "confirm")).status).toBe(200);
    expect((await assign(second.driver.id, second.vehicle.id)).status).toBe(200);

    const emails = (await notificationsOf(trip.id)).filter((row) => row.customerId === customer.id);
    expect(emails.map((row) => row.kind)).toEqual([
      "BOOKING_RECEIVED",
      "TRIP_CONFIRMED",
      "DRIVER_ASSIGNED",
    ]);
    expect(emails[1]?.body).toContain(`السائق: ${first.driver.firstName}`);
    expect(emails[2]?.body).toContain(`السائق: ${second.driver.firstName}`);
    expect(emails[2]?.body).toContain(second.vehicle.plateNumber);
    expect(emails[2]?.data).toMatchObject({
      code: trip.code,
      link: `https://local.terhal.co:3000/trips/${trip.id}`,
    });
  });

  it("tells the booker why staff cancelled, and staff when a customer cancels", async () => {
    const { customer, agent } = await signedInCustomer();
    const byStaff = await bookedTrip(agent, world);
    await act(staff, byStaff.trip.id, "cancel", { reason: "NO_VEHICLE" });
    const cancelled = (await notificationsOf(byStaff.trip.id)).filter(
      (row) => row.kind !== "BOOKING_RECEIVED" && row.kind !== "NEW_BOOKING",
    );
    expect(cancelled.map((row) => [row.kind, row.customerId])).toEqual([
      ["TRIP_CANCELLED", customer.id],
    ]);
    expect(cancelled[0]?.body).toContain("السبب: لم تتوفر سيارة.");

    const byThem = await bookedTrip(agent, world);
    await agent.request(`/v1/site/trips/${byThem.trip.id}/cancel`, {
      method: "POST",
      json: { reason: "Plans changed" },
    });
    const theirs = (await notificationsOf(byThem.trip.id)).filter(
      (row) => row.kind !== "BOOKING_RECEIVED" && row.kind !== "NEW_BOOKING",
    );
    expect(theirs.map((row) => row.kind).sort()).toEqual([
      "CANCELLATION_RECEIPT",
      "CANCELLED_BY_BOOKER",
      "CANCELLED_BY_BOOKER",
    ]);
    expect(theirs.find((row) => row.kind === "CANCELLED_BY_BOOKER")?.body).toContain(
      "Plans changed",
    );
  });

  it("emails the proposed price and tells staff the answer", async () => {
    const { customer, agent } = await signedInCustomer();
    const { trip } = await bookedTrip(agent, world, {
      classId: world.vip.id,
      expectedPrice: undefined,
    });
    expect(
      (await act(staff, trip.id, "price", { totalPrice: "2000.00" })).status,
    ).toBe(200);
    const proposed = (await notificationsOf(trip.id)).find((row) => row.kind === "PRICE_PROPOSED");
    expect(proposed).toMatchObject({ customerId: customer.id });
    expect(proposed?.body).toContain("٢٬٠٠٠ جنيه");
    expect((await remindersOf(trip.id)).PRICE).toBe(
      new Date(new Date(trip.pickupDate).getTime() - 24 * HOUR).toISOString(),
    );

    const accepted = await agent.request(`/v1/site/trips/${trip.id}/price/accept`, {
      method: "POST",
      json: { expectedPrice: "2000.00" },
    });
    expect(accepted.status).toBe(200);
    const answers = (await notificationsOf(trip.id)).filter((row) => row.kind === "PRICE_ACCEPTED");
    expect(answers.map((row) => row.staffId).sort()).toEqual([staffId, otherStaffId].sort());
    // Answered: no price reminder.
    expect((await remindersOf(trip.id)).PRICE).toBeNull();
  });

  it("thanks the booker once, even when a trip is completed again after a reopen", async () => {
    const { customer, agent } = await signedInCustomer();
    const { trip } = await bookedTrip(agent, world);
    const { driver, vehicle } = await fleet();
    await prisma.trip.update({
      where: { id: trip.id },
      data: { driverId: driver.id, vehicleId: vehicle.id },
    });
    for (const step of ["confirm", "start", "end", "complete", "reopen", "complete"]) {
      expect((await act(staff, trip.id, step)).status).toBe(200);
    }
    const thanks = (await notificationsOf(trip.id)).filter(
      (row) => row.kind === "TRIP_COMPLETED" && row.customerId === customer.id,
    );
    expect(thanks).toHaveLength(1);
  });
});

describe("reminders from trip events", () => {
  let world: TripWorld;
  let staff: Agent;
  let site: Agent;
  beforeEach(async () => {
    world = await tripWorld();
    staff = (await tripsStaff()).agent;
    site = (await signedInCustomer()).agent;
  });

  it("are scheduled on confirmation, moved with the pickup and dropped on cancel", async () => {
    const pickup = pickupIn(72);
    const { trip } = await bookedTrip(site, world, { pickupDate: pickup.toISOString() });
    const at = (date: Date, hours: number) => new Date(date.getTime() - hours * HOUR).toISOString();

    expect(await remindersOf(trip.id)).toEqual({ UNASSIGNED: at(pickup, 2) });

    await act(staff, trip.id, "confirm");
    expect(await remindersOf(trip.id)).toEqual({
      UNASSIGNED: at(pickup, 2),
      PICKUP: at(pickup, 24),
    });

    const later = pickupIn(96);
    const moved = await staff.request(`/v1/staff/trips/${trip.id}`, {
      method: "PATCH",
      json: { pickupDate: later.toISOString() },
    });
    expect(moved.status).toBe(200);
    expect(await remindersOf(trip.id)).toEqual({
      UNASSIGNED: at(later, 2),
      PICKUP: at(later, 24),
    });

    const office = await prisma.office.create({
      data: { name: "Partner", contact: "Ali", phone: "+201000000009", address: "Cairo" },
    });
    await staff.request(`/v1/staff/trips/${trip.id}/assignment`, {
      method: "PUT",
      json: { officeId: office.id },
    });
    expect((await remindersOf(trip.id)).UNASSIGNED).toBeNull();

    await act(staff, trip.id, "cancel", { reason: "DUPLICATE" });
    expect(await remindersOf(trip.id)).toEqual({ UNASSIGNED: null, PICKUP: null });
  });
});
