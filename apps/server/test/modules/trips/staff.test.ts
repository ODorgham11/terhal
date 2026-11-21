import { beforeEach, describe, expect, it } from "vitest";
import { overview } from "../../../src/modules/trips/application/queries";
import { prisma } from "../../../src/platform/db/prisma";
import { resetDatabase } from "../../support/database";
import { resetRedis } from "../../support/redis";
import {
  act,
  bookedTrip,
  events,
  fleet,
  json,
  pickupIn,
  pins,
  signedInCustomer,
  staffBook,
  tripWorld,
  tripsStaff,
  type Booked,
  type TripBody,
  type TripWorld,
} from "../../support/trips";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

const problem = (response: Response) =>
  json<{ code: string; reason?: string; leg?: string; tripStatus?: string }>(response);

const staffBooking = (world: TripWorld, overrides: Record<string, unknown> = {}) => ({
  classId: world.economy.id,
  car: "SEDAN",
  pickup: pins.degla,
  dropoff: pins.smouha,
  pickupDate: pickupIn(1).toISOString(),
  passengers: 2,
  clientName: "Walk In",
  clientPhone: "01001112223",
  ...overrides,
});

describe("staff booking", () => {
  let world: TripWorld;
  beforeEach(async () => {
    world = await tripWorld();
  });

  it("books on their own at the list price, with themselves as the booker", async () => {
    const { staff, agent } = await tripsStaff();
    const response = await staffBook(agent, staffBooking(world));
    expect(response.status).toBe(201);
    const { trip } = await json<Booked>(response);
    expect(trip).toMatchObject({
      source: "STAFF",
      priceState: "QUOTED",
      totalPrice: "1500.00",
      clientName: "Walk In",
      clientPhone: "+201001112223",
      booker: { type: "STAFF", id: staff.id },
    });
    const [created] = await events(trip.id);
    expect(created).toMatchObject({ action: "trip.created", staffId: staff.id });
  });

  it("can set its own price, and needs one when booking on their own", async () => {
    const { agent } = await tripsStaff();
    const priced = await json<Booked>(
      await staffBook(agent, staffBooking(world, { totalPrice: "999.5" })),
    );
    expect(priced.trip.totalPrice).toBe("999.50");

    const unpriced = await staffBook(agent, staffBooking(world, { classId: world.vip.id }));
    expect(unpriced.status).toBe(422);
    expect(await problem(unpriced)).toMatchObject({ code: "PRICE_REQUIRED", leg: "outbound" });
  });

  it("books for a customer: the customer is the booker, sees it, and it can wait for a price", async () => {
    const { staff, agent } = await tripsStaff();
    const { customer, agent: site } = await signedInCustomer();
    const response = await staffBook(
      agent,
      staffBooking(world, {
        customerId: customer.id,
        classId: world.vip.id,
        clientName: undefined,
        clientPhone: undefined,
      }),
    );
    expect(response.status).toBe(201);
    const { trip } = await json<Booked>(response);
    expect(trip).toMatchObject({
      source: "STAFF",
      priceState: "REQUESTED",
      totalPrice: null,
      clientName: "Mona Adel",
      clientPhone: customer.phone,
      booker: { type: "CUSTOMER", id: customer.id },
    });
    const [created] = await events(trip.id);
    expect(created).toMatchObject({ staffId: staff.id, customerId: null });

    const mine = await json<{ data: TripBody[] }>(await site.request("/v1/site/trips"));
    expect(mine.data.map((item) => item.id)).toEqual([trip.id]);

    const suspended = await prisma.customer.update({
      where: { id: customer.id },
      data: { status: "SUSPENDED" },
    });
    const refused = await staffBook(agent, staffBooking(world, { customerId: suspended.id }));
    expect(refused.status).toBe(422);
    expect((await problem(refused)).code).toBe("CUSTOMER_NOT_AVAILABLE");
  });

  it("needs the passenger's details without a customer", async () => {
    const { agent } = await tripsStaff();
    const response = await staffBook(
      agent,
      staffBooking(world, { clientName: undefined, clientPhone: undefined }),
    );
    expect(response.status).toBe(400);
  });

  it("books any future time, and the past only when backdated", async () => {
    const { agent } = await tripsStaff();
    const soon = new Date(Date.now() + 10 * 60 * 1000 + 7_000);
    expect(
      (await staffBook(agent, staffBooking(world, { pickupDate: soon.toISOString() }))).status,
    ).toBe(201);

    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const refused = await staffBook(agent, staffBooking(world, { pickupDate: past }));
    expect(await problem(refused)).toMatchObject({
      code: "PICKUP_TIME_INVALID",
      reason: "IN_PAST",
    });
    expect(
      (await staffBook(agent, staffBooking(world, { pickupDate: past, backdated: true }))).status,
    ).toBe(201);
  });

  it("books a return and replays the same Idempotency-Key", async () => {
    const { agent } = await tripsStaff();
    const body = staffBooking(world, { return: { pickupDate: pickupIn(30).toISOString() } });
    const first = await staffBook(agent, body, "staff-key-1");
    const { trip, returnTrip } = await json<Booked>(first);
    expect(returnTrip).toMatchObject({ previousTripId: trip.id, totalPrice: "1400.00" });
    const replay = await staffBook(agent, body, "staff-key-1");
    expect(replay.status).toBe(200);
    expect(await json<Booked>(replay)).toMatchObject({
      trip: { id: trip.id },
      returnTrip: { id: returnTrip?.id },
    });
  });

  it("needs the trips permission", async () => {
    const { agent } = await tripsStaff(["fleet"]);
    expect((await staffBook(agent, staffBooking(world))).status).toBe(403);
    expect((await agent.request("/v1/staff/trips")).status).toBe(403);
    expect((await agent.request("/v1/staff/overview")).status).toBe(403);
  });
});

describe("the trip list and detail", () => {
  it("filters by status, dates, search, assignment and office", async () => {
    const world = await tripWorld();
    const { agent } = await tripsStaff();
    const { agent: site } = await signedInCustomer();
    const a = (await bookedTrip(site, world, { clientName: "Ahmed Nour" })).trip;
    const b = (
      await bookedTrip(site, world, {
        pickupDate: pickupIn(48).toISOString(),
        clientPhone: "01009998887",
      })
    ).trip;
    const { driver, vehicle } = await fleet();
    await prisma.trip.update({
      where: { id: b.id },
      data: { status: "CONFIRMED", driverId: driver.id, vehicleId: vehicle.id },
    });

    const ids = async (query: string) =>
      (await json<{ data: TripBody[] }>(await agent.request(`/v1/staff/trips?${query}`))).data.map(
        (trip) => trip.id,
      );

    expect(await ids("")).toEqual([b.id, a.id]);
    expect(await ids("status=CONFIRMED")).toEqual([b.id]);
    expect(await ids(`from=${pickupIn(36).toISOString()}`)).toEqual([b.id]);
    expect(await ids(`to=${pickupIn(36).toISOString()}`)).toEqual([a.id]);
    expect(await ids("q=ahmed")).toEqual([a.id]);
    expect(await ids("q=01009998887")).toEqual([b.id]);
    expect(await ids(`q=${a.code.toLowerCase()}`)).toEqual([a.id]);
    expect(await ids(`driverId=${driver.id}`)).toEqual([b.id]);
    expect(await ids(`vehicleId=${vehicle.id}`)).toEqual([b.id]);
    expect(await ids("unassigned=true")).toEqual([a.id]);

    const page = await json<{ data: TripBody[]; nextCursor: string }>(
      await agent.request("/v1/staff/trips?limit=1"),
    );
    expect(page.nextCursor).toBe(b.id);
    expect(await ids(`limit=1&cursor=${page.nextCursor}`)).toEqual([a.id]);
  });

  it("shows a trip with its history, linked trips and no report yet", async () => {
    const world = await tripWorld();
    const { agent } = await tripsStaff();
    const { agent: site } = await signedInCustomer();
    const { trip, returnTrip } = await bookedTrip(site, world, {
      return: { pickupDate: pickupIn(72).toISOString(), expectedPrice: "1400" },
    });
    const detail = await json(await agent.request(`/v1/staff/trips/${trip.id}`));
    expect(detail).toMatchObject({
      id: trip.id,
      booker: { type: "CUSTOMER", name: "Mona Adel" },
      previousTrip: null,
      returnTrip: { id: returnTrip?.id, code: returnTrip?.code, status: "PENDING" },
      report: null,
      events: [{ action: "trip.created", actor: { type: "CUSTOMER", name: "Mona Adel" } }],
    });
    expect((await agent.request("/v1/staff/trips/nope")).status).toBe(404);
  });
});

describe("editing a trip", () => {
  it("records every change with before and after, and never reprices", async () => {
    const world = await tripWorld();
    const { staff, agent } = await tripsStaff();
    const { agent: site } = await signedInCustomer();
    const { trip } = await bookedTrip(site, world);

    const response = await agent.request(`/v1/staff/trips/${trip.id}`, {
      method: "PATCH",
      json: {
        dropoff: pins.alexandriaOnly,
        passengers: 3,
        notes: "Child seat",
        classId: world.vip.id,
      },
    });
    expect(response.status).toBe(200);
    expect(await json<TripBody>(response)).toMatchObject({
      dropoff: { id: world.alexandria.id, nameEn: "Alexandria" },
      passengers: 3,
      notes: "Child seat",
      class: { id: world.vip.id, nameEn: "VIP" },
      totalPrice: "1500.00",
    });

    const updated = (await events(trip.id)).at(-1);
    expect(updated).toMatchObject({
      action: "trip.updated",
      staffId: staff.id,
      data: {
        changes: {
          passengers: { before: 2, after: 3 },
          notes: { before: null, after: "Child seat" },
          dropoffId: { before: world.smouha.id, after: world.alexandria.id },
          dropoffSnapshot: { before: "Smouha", after: "Alexandria" },
          classId: { before: world.economy.id, after: world.vip.id },
        },
      },
    });

    // Changing nothing records nothing.
    const count = (await events(trip.id)).length;
    await agent.request(`/v1/staff/trips/${trip.id}`, { method: "PATCH", json: { passengers: 3 } });
    expect(await events(trip.id)).toHaveLength(count);

    const price = await agent.request(`/v1/staff/trips/${trip.id}`, {
      method: "PATCH",
      json: { totalPrice: "1650" },
    });
    expect(await json<TripBody>(price)).toMatchObject({ totalPrice: "1650.00" });
    expect((await events(trip.id)).at(-1)?.data).toMatchObject({
      changes: { totalPrice: { before: "1500.00", after: "1650.00" } },
    });
  });

  it("checks fit, the assigned vehicle, the route and the status", async () => {
    const world = await tripWorld();
    const { agent } = await tripsStaff();
    const { agent: site } = await signedInCustomer();
    const { trip } = await bookedTrip(site, world);
    const patch = (body: unknown) =>
      agent.request(`/v1/staff/trips/${trip.id}`, { method: "PATCH", json: body });

    expect((await problem(await patch({ passengers: 6 }))).code).toBe("LOAD_DOES_NOT_FIT");
    expect((await problem(await patch({ dropoff: pins.sea }))).code).toBe("OUT_OF_COVERAGE");
    expect((await problem(await patch({ dropoff: pins.degla }))).code).toBe("QUOTE_SAME_PLACE");
    expect((await patch({})).status).toBe(400);

    const { vehicle } = await fleet();
    await prisma.trip.update({ where: { id: trip.id }, data: { vehicleId: vehicle.id } });
    // The assigned sedan is too small for an SUV booking.
    expect((await problem(await patch({ car: "SUV" }))).code).toBe("VEHICLE_TOO_SMALL");

    await prisma.trip.update({ where: { id: trip.id }, data: { status: "AWAITING_REPORT" } });
    const details = await patch({ notes: "late" });
    expect(details.status).toBe(409);
    expect(await problem(details)).toMatchObject({
      code: "TRIP_STATUS_CONFLICT",
      tripStatus: "AWAITING_REPORT",
    });
    expect((await patch({ totalPrice: "1700", paymentMethod: "CASH_TO_DRIVER" })).status).toBe(200);
    expect((await events(trip.id)).at(-1)?.action).toBe("trip.updated");
    expect((await patch({ paidAt: new Date().toISOString() })).status).toBe(200);
    expect((await events(trip.id)).at(-1)?.action).toBe("trip.payment_recorded");

    await prisma.trip.update({ where: { id: trip.id }, data: { status: "COMPLETED" } });
    expect((await patch({ totalPrice: "1800" })).status).toBe(409);
  });

  it("won't set the price of a trip waiting for one", async () => {
    const world = await tripWorld();
    const { agent } = await tripsStaff();
    const { agent: site } = await signedInCustomer();
    const { trip } = await bookedTrip(site, world, {
      classId: world.vip.id,
      expectedPrice: undefined,
    });
    const response = await agent.request(`/v1/staff/trips/${trip.id}`, {
      method: "PATCH",
      json: { totalPrice: "100" },
    });
    expect(response.status).toBe(409);
    expect((await problem(response)).code).toBe("PRICE_REQUEST_OPEN");
  });
});

describe("the overview", () => {
  it("counts what needs attention", async () => {
    const world = await tripWorld();
    const { agent } = await tripsStaff();
    const { agent: site } = await signedInCustomer();
    const create = async (data: Record<string, unknown>) => {
      const { trip } = await bookedTrip(site, world);
      await prisma.trip.update({ where: { id: trip.id }, data });
      return trip;
    };
    const now = new Date();
    const { driver, vehicle } = await fleet();
    const second = await fleet();

    // Picks up later today (if there's time left today in Cairo) or tomorrow: counted by when it falls.
    await create({ status: "CONFIRMED", pickupDate: new Date(now.getTime() + 60 * 1000) });
    await create({ status: "IN_PROGRESS", driverId: driver.id, vehicleId: vehicle.id });
    await create({ status: "AWAITING_REPORT" });
    await create({ status: "CANCELLED", pickupDate: new Date(now.getTime() + 60 * 1000) });
    await create({
      status: "PENDING",
      totalPrice: null,
      priceState: "REQUESTED",
      pickupDate: new Date(now.getTime() - 60 * 60 * 1000),
      driverId: second.driver.id,
      vehicleId: second.vehicle.id,
    });

    const counts = await overview(now);
    expect(counts).toMatchObject({
      unassigned: 1,
      inProgress: 1,
      awaitingReport: 1,
      overdue: 1,
      priceRequests: 1,
    });
    expect(counts.today + counts.tomorrow).toBeGreaterThanOrEqual(1);

    const response = await agent.request("/v1/staff/overview");
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ inProgress: 1, priceRequests: 1 });
  });

  it("counts Cairo's today and tomorrow", async () => {
    const world = await tripWorld();
    const { agent: site } = await signedInCustomer();
    const { trip } = await bookedTrip(site, world);
    const { trip: other } = await bookedTrip(site, world);
    // 23:30 in Cairo (UTC+2 in winter) on 1 December, and 00:30 on the 2nd.
    await prisma.trip.update({
      where: { id: trip.id },
      data: { pickupDate: new Date("2026-12-01T21:30:00Z") },
    });
    await prisma.trip.update({
      where: { id: other.id },
      data: { pickupDate: new Date("2026-12-01T22:30:00Z") },
    });
    const counts = await overview(new Date("2026-12-01T08:00:00Z"));
    expect(counts).toMatchObject({ today: 1, tomorrow: 1 });
  });
});

describe("lifecycle permissions", () => {
  it("need trips for every action", async () => {
    const world = await tripWorld();
    const { agent: site } = await signedInCustomer();
    const { trip } = await bookedTrip(site, world);
    const { agent } = await tripsStaff(["fleet", "pricing", "customers"]);
    for (const action of ["confirm", "start", "end", "complete", "unstart", "reopen"]) {
      expect((await act(agent, trip.id, action)).status).toBe(403);
    }
    expect((await agent.request(`/v1/staff/trips/${trip.id}`)).status).toBe(403);
    expect(
      (await agent.request(`/v1/staff/trips/${trip.id}/assignment`, { method: "PUT", json: {} }))
        .status,
    ).toBe(403);
    // And staff have no session on the site.
    expect((await agent.request("/v1/site/trips")).status).toBe(401);
  });
});
