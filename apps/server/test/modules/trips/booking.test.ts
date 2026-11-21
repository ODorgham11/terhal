import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../src/platform/db/prisma";
import { resetDatabase } from "../../support/database";
import { SITE_ORIGIN, createAgent } from "../../support/http";
import { resetRedis } from "../../support/redis";
import {
  book,
  bookedTrip,
  booking,
  events,
  json,
  pickupIn,
  pins,
  signedInCustomer,
  tripWorld,
  verifiedGuest,
  type Booked,
  type TripBody,
  type TripWorld,
} from "../../support/trips";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

const problem = (response: Response) =>
  json<{ code: string; reason?: string; leg?: string; price?: string | null; errors?: unknown[] }>(
    response,
  );

describe("booking on the site", () => {
  let world: TripWorld;
  beforeEach(async () => {
    world = await tripWorld();
  });

  it("books a priced trip for a customer, with a code, snapshots and a created event", async () => {
    const { customer, agent } = await signedInCustomer();
    const response = await book(agent, booking(world, { notes: "Two suitcases" }));
    expect(response.status).toBe(201);
    const { trip, returnTrip } = await json<Booked>(response);

    expect(returnTrip).toBeNull();
    expect(trip.code).toMatch(/^TRH-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    expect(trip).toMatchObject({
      status: "PENDING",
      priceState: "QUOTED",
      totalPrice: "1500.00",
      clientName: "Mona Adel",
      clientPhone: customer.phone,
      class: { id: world.economy.id, nameEn: "Economy", nameAr: "اقتصادي" },
      pickup: { id: world.degla.id, nameEn: "Degla", nameAr: "دجلة", latitude: 29.96 },
      dropoff: { id: world.smouha.id, nameEn: "Smouha", nameAr: "سموحة" },
      notes: "Two suitcases",
      assignment: null,
    });

    const stored = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    expect(stored).toMatchObject({ customerId: customer.id, source: "CUSTOMER" });
    const [created] = await events(trip.id);
    expect(created).toMatchObject({
      action: "trip.created",
      customerId: customer.id,
      data: { to: "PENDING", priceState: "QUOTED", totalPrice: "1500.00" },
    });

    // Renaming the class or the place later doesn't rewrite the trip.
    await prisma.tripClass.update({ where: { id: world.economy.id }, data: { nameEn: "Basic" } });
    const read = await agent.request(`/v1/site/trips/${trip.id}`);
    expect(await json<TripBody>(read)).toMatchObject({ class: { nameEn: "Economy" } });
  });

  it("lets someone book for another passenger", async () => {
    const { agent } = await signedInCustomer();
    const { trip } = await bookedTrip(agent, world, {
      clientName: "Sara Ali",
      clientPhone: "01005556667",
    });
    expect(trip).toMatchObject({ clientName: "Sara Ali", clientPhone: "+201005556667" });
  });

  it("books for a verified guest, and refuses an unverified one or nobody", async () => {
    const { session, agent } = await verifiedGuest();
    const { trip } = await bookedTrip(agent, world);
    expect(trip.clientName).toBe("Karim Fathy");
    expect(await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).toMatchObject({
      guestSessionId: session.id,
    });

    const unverified = await verifiedGuest("other@example.com", false);
    const refused = await book(unverified.agent, booking(world));
    expect(refused.status).toBe(403);
    expect((await problem(refused)).code).toBe("VERIFICATION_REQUIRED");

    const anonymous = await book(createAgent(SITE_ORIGIN), booking(world));
    expect(anonymous.status).toBe(401);
  });

  it("enforces the pickup time rules: lead time, grid, horizon", async () => {
    const { agent } = await signedInCustomer();
    const cases: [Date, string][] = [
      [pickupIn(2), "TOO_SOON"],
      [new Date(pickupIn(24).getTime() + 5 * 60 * 1000), "OFF_GRID"],
      [pickupIn(24 * 91), "TOO_FAR"],
    ];
    for (const [pickupDate, reason] of cases) {
      const response = await book(agent, booking(world, { pickupDate: pickupDate.toISOString() }));
      expect(response.status).toBe(422);
      expect(await problem(response)).toMatchObject({
        code: "PICKUP_TIME_INVALID",
        reason,
        leg: "outbound",
      });
    }
    // Just over 3 hours and just under 90 days are fine.
    expect(
      (await book(agent, booking(world, { pickupDate: pickupIn(3.25).toISOString() }))).status,
    ).toBe(201);
    expect(
      (await book(agent, booking(world, { pickupDate: pickupIn(24 * 89.9).toISOString() }))).status,
    ).toBe(201);
  });

  it("needs both ends covered and not the same place", async () => {
    const { agent } = await signedInCustomer();
    const outside = await book(agent, booking(world, { dropoff: pins.sea }));
    expect(outside.status).toBe(422);
    expect(await problem(outside)).toMatchObject({ code: "OUT_OF_COVERAGE" });

    const same = await book(
      agent,
      booking(world, { dropoff: { latitude: 29.961, longitude: 31.261 } }),
    );
    expect(same.status).toBe(422);
    expect(await problem(same)).toMatchObject({ code: "QUOTE_SAME_PLACE" });
  });

  it("refuses a load that doesn't fit the body", async () => {
    const { agent } = await signedInCustomer();
    const response = await book(agent, booking(world, { passengers: 5 }));
    expect(response.status).toBe(422);
    expect((await problem(response)).code).toBe("LOAD_DOES_NOT_FIT");

    const luggage = await book(agent, booking(world, { largeLuggage: 3 }));
    expect((await problem(luggage)).code).toBe("LOAD_DOES_NOT_FIT");
  });

  it("refuses an unknown or archived class", async () => {
    const { agent } = await signedInCustomer();
    await prisma.tripClass.update({
      where: { id: world.economy.id },
      data: { archivedAt: new Date() },
    });
    const response = await book(agent, booking(world));
    expect(response.status).toBe(400);
    expect(await problem(response)).toMatchObject({
      code: "VALIDATION_FAILED",
      errors: [{ path: "classId" }],
    });
  });

  it("fails with PRICE_CHANGED and the current price, including none", async () => {
    const { agent } = await signedInCustomer();
    const changed = await book(agent, booking(world, { expectedPrice: "1200" }));
    expect(changed.status).toBe(409);
    expect(await problem(changed)).toMatchObject({
      code: "PRICE_CHANGED",
      price: "1500.00",
      leg: "outbound",
    });

    // A priced route booked as if it had no price.
    const missing = await book(agent, booking(world, { expectedPrice: undefined }));
    expect(await problem(missing)).toMatchObject({ code: "PRICE_CHANGED", price: "1500.00" });

    // A route without a price, booked at a price the customer saw earlier.
    const unpriced = await book(
      agent,
      booking(world, { classId: world.vip.id, expectedPrice: "1500" }),
    );
    expect(unpriced.status).toBe(409);
    expect(await problem(unpriced)).toMatchObject({ code: "PRICE_CHANGED", price: null });
    expect(await prisma.trip.count()).toBe(0);
  });

  it("books an unpriced option on request", async () => {
    const { agent } = await signedInCustomer();
    const { trip } = await bookedTrip(agent, world, {
      classId: world.vip.id,
      expectedPrice: undefined,
    });
    expect(trip).toMatchObject({ status: "PENDING", priceState: "REQUESTED", totalPrice: null });
  });

  it("caps pending trips at 3 per customer, counting both legs of a return", async () => {
    const { agent } = await signedInCustomer();
    await bookedTrip(agent, world);
    await bookedTrip(agent, world, {
      return: { pickupDate: pickupIn(48).toISOString(), expectedPrice: "1400" },
    });
    const fourth = await book(agent, booking(world));
    expect(fourth.status).toBe(409);
    expect(await problem(fourth)).toMatchObject({ code: "PENDING_TRIP_LIMIT" });

    // Another customer isn't affected; a cancelled trip frees a place.
    const other = await signedInCustomer();
    expect((await book(other.agent, booking(world))).status).toBe(201);
    const first = await prisma.trip.findFirstOrThrow({ where: { previousTripId: null } });
    await prisma.trip.update({ where: { id: first.id }, data: { status: "CANCELLED" } });
    expect((await book(agent, booking(world))).status).toBe(201);
  });

  it("caps a guest's pending trips across sessions with the same email", async () => {
    const first = await verifiedGuest("same@example.com");
    const second = await verifiedGuest("same@example.com");
    await bookedTrip(first.agent, world);
    await bookedTrip(first.agent, world);
    await bookedTrip(second.agent, world);
    const response = await book(second.agent, booking(world));
    expect((await problem(response)).code).toBe("PENDING_TRIP_LIMIT");
  });

  it("holds the cap when bookings arrive at once", async () => {
    const { agent } = await signedInCustomer();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => book(agent, booking(world))),
    );
    expect(responses.filter((response) => response.status === 201)).toHaveLength(3);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(2);
    expect(await prisma.trip.count({ where: { status: "PENDING" } })).toBe(3);
  });

  it("requires an Idempotency-Key and returns the first booking on a replay", async () => {
    const { agent } = await signedInCustomer();
    const missing = await agent.request("/v1/site/trips", {
      method: "POST",
      json: booking(world),
    });
    expect(missing.status).toBe(400);
    expect(await problem(missing)).toMatchObject({ code: "VALIDATION_FAILED" });

    const first = await book(agent, booking(world), "key-000001");
    expect(first.status).toBe(201);
    const replay = await book(agent, booking(world), "key-000001");
    expect(replay.status).toBe(200);
    expect((await json<Booked>(replay)).trip.id).toBe((await json<Booked>(first)).trip.id);
    expect(await prisma.trip.count()).toBe(1);

    // Two at once with one key still make one trip.
    const racing = await Promise.all([
      book(agent, booking(world), "key-000002"),
      book(agent, booking(world), "key-000002"),
    ]);
    const ids = await Promise.all(racing.map(async (r) => (await json<Booked>(r)).trip.id));
    expect(new Set(ids).size).toBe(1);
    expect(await prisma.trip.count()).toBe(2);

    // Another booker's key never matches.
    const other = await signedInCustomer();
    expect((await book(other.agent, booking(world), "key-000001")).status).toBe(201);
  });

  it("books a return as a second linked trip, reversed and priced from the reverse route", async () => {
    const { agent } = await signedInCustomer();
    const { trip, returnTrip } = await bookedTrip(agent, world, {
      return: { pickupDate: pickupIn(72).toISOString(), expectedPrice: "1400.00" },
    });
    expect(returnTrip).toMatchObject({
      status: "PENDING",
      totalPrice: "1400.00",
      previousTripId: trip.id,
      pickup: { id: world.smouha.id },
      dropoff: { id: world.degla.id },
      class: { id: world.economy.id },
      car: "SEDAN",
      passengers: 2,
    });
    expect(returnTrip?.code).not.toBe(trip.code);
    const read = await json<TripBody>(await agent.request(`/v1/site/trips/${trip.id}`));
    expect(read.returnTripId).toBe(returnTrip?.id);
  });

  it("lets the return start or end elsewhere, and checks its own price and time", async () => {
    const { agent } = await signedInCustomer();
    const elsewhere = await bookedTrip(agent, world, {
      return: {
        pickupDate: pickupIn(72).toISOString(),
        pickup: pins.alexandriaOnly,
      },
    });
    expect(elsewhere.returnTrip).toMatchObject({
      priceState: "REQUESTED",
      pickup: { id: world.alexandria.id },
      dropoff: { id: world.degla.id },
    });

    const wrongPrice = await book(
      agent,
      booking(world, { return: { pickupDate: pickupIn(72).toISOString(), expectedPrice: "1500" } }),
    );
    expect(await problem(wrongPrice)).toMatchObject({
      code: "PRICE_CHANGED",
      price: "1400.00",
      leg: "return",
    });

    const before = await book(
      agent,
      booking(world, { return: { pickupDate: pickupIn(12).toISOString(), expectedPrice: "1400" } }),
    );
    expect(await problem(before)).toMatchObject({
      code: "PICKUP_TIME_INVALID",
      reason: "BEFORE_OUTBOUND",
      leg: "return",
    });
  });
});

describe("seeing trips on the site", () => {
  it("shows a customer only their own trips", async () => {
    const world = await tripWorld();
    const mona = await signedInCustomer();
    const other = await signedInCustomer();
    const { trip } = await bookedTrip(mona.agent, world);
    await bookedTrip(other.agent, world);

    const list = await json<{ data: TripBody[] }>(await mona.agent.request("/v1/site/trips"));
    expect(list.data.map((item) => item.id)).toEqual([trip.id]);
    expect((await other.agent.request(`/v1/site/trips/${trip.id}`)).status).toBe(404);
  });

  it("shows a verified guest every guest trip booked with the same verified email", async () => {
    const world = await tripWorld();
    const first = await verifiedGuest("karim@example.com");
    const later = await verifiedGuest("karim@example.com");
    const stranger = await verifiedGuest("someone@example.com");
    const { trip } = await bookedTrip(first.agent, world);

    const list = await json<{ data: TripBody[] }>(await later.agent.request("/v1/site/trips"));
    expect(list.data.map((item) => item.id)).toEqual([trip.id]);
    expect((await later.agent.request(`/v1/site/trips/${trip.id}`)).status).toBe(200);
    expect((await stranger.agent.request(`/v1/site/trips/${trip.id}`)).status).toBe(404);
  });

  it("shows the driver and vehicle once the trip is confirmed and assigned", async () => {
    const world = await tripWorld();
    const { agent } = await signedInCustomer();
    const { trip } = await bookedTrip(agent, world);
    const driver = await prisma.driver.create({
      data: { firstName: "Hany", lastName: "Said", phone: "+201220000001" },
    });
    const vehicle = await prisma.vehicle.create({
      data: { make: "Kia", model: "Cerato", plateNumber: "ABC 1", color: "Blue", body: "SEDAN" },
    });
    await prisma.trip.update({
      where: { id: trip.id },
      data: { driverId: driver.id, vehicleId: vehicle.id },
    });
    const pending = await json<TripBody>(await agent.request(`/v1/site/trips/${trip.id}`));
    expect(pending.assignment).toBeNull();

    await prisma.trip.update({ where: { id: trip.id }, data: { status: "CONFIRMED" } });
    const confirmed = await json<TripBody>(await agent.request(`/v1/site/trips/${trip.id}`));
    expect(confirmed.assignment).toEqual({
      driver: { firstName: "Hany", phone: "+201220000001" },
      vehicle: { make: "Kia", model: "Cerato", color: "Blue", plateNumber: "ABC 1" },
      partner: false,
    });
  });
});
