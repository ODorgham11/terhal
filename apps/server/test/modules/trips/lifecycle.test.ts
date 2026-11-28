import { beforeEach, describe, expect, it } from "vitest";
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
  signedInCustomer,
  staffBook,
  tripWorld,
  tripsStaff,
  verifiedGuest,
  type Agent,
  type Booked,
  type TripBody,
  type TripWorld,
} from "../../support/trips";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

const problem = (response: Response) =>
  json<{ code: string; tripStatus?: string; price?: string; field?: string }>(response);

const statusOf = async (id: string) =>
  (await prisma.trip.findUniqueOrThrow({ where: { id } })).status;

describe("the staff lifecycle", () => {
  let world: TripWorld;
  let staff: Agent;
  let staffId: string;
  let site: Agent;
  beforeEach(async () => {
    world = await tripWorld();
    const signedIn = await tripsStaff();
    staff = signedIn.agent;
    staffId = signedIn.staff.id;
    site = (await signedInCustomer()).agent;
  });

  it("confirms, starts, ends and completes, recording each move", async () => {
    const { trip } = await bookedTrip(site, world);
    const { driver, vehicle } = await fleet();

    const confirmed = await act(staff, trip.id, "confirm");
    expect(confirmed.status).toBe(200);
    expect(await json<TripBody>(confirmed)).toMatchObject({ status: "CONFIRMED" });

    const unassigned = await act(staff, trip.id, "start");
    expect(unassigned.status).toBe(409);
    expect((await problem(unassigned)).code).toBe("ASSIGNMENT_REQUIRED");

    await prisma.trip.update({
      where: { id: trip.id },
      data: { driverId: driver.id, vehicleId: vehicle.id },
    });
    expect((await act(staff, trip.id, "start")).status).toBe(200);
    expect((await act(staff, trip.id, "end")).status).toBe(200);
    const unreported = await act(staff, trip.id, "complete");
    expect(unreported.status).toBe(409);
    expect((await problem(unreported)).code).toBe("REPORT_REQUIRED");

    const now = new Date();
    await prisma.tripReport.create({
      data: {
        tripId: trip.id,
        startedAt: now,
        vehiclePickup: "Garage",
        startMileage: 100,
        pickupAt: now,
        dropoffAt: new Date(now.getTime() + 1 * 60_000),
        vehicleDropoff: "Garage",
        endedAt: new Date(now.getTime() + 2 * 60_000),
        endMileage: 300,
      },
    });
    const completed = await act(staff, trip.id, "complete");
    expect(await json<TripBody>(completed)).toMatchObject({ status: "COMPLETED" });

    const moves = (await events(trip.id)).slice(1);
    expect(moves.map((event) => [event.action, event.data, event.staffId])).toEqual([
      ["trip.confirmed", { from: "PENDING", to: "CONFIRMED" }, staffId],
      ["trip.started", { from: "CONFIRMED", to: "IN_PROGRESS" }, staffId],
      ["trip.ended", { from: "IN_PROGRESS", to: "AWAITING_REPORT" }, staffId],
      ["trip.completed", { from: "AWAITING_REPORT", to: "COMPLETED" }, staffId],
    ]);
  });

  it("starts an office trip without a driver or vehicle", async () => {
    const { trip } = await bookedTrip(site, world);
    const office = await prisma.office.create({
      data: { name: "Partner", contact: "Ali", phone: "+201000000009", address: "Cairo" },
    });
    await prisma.trip.update({
      where: { id: trip.id },
      data: { status: "CONFIRMED", officeId: office.id },
    });
    expect((await act(staff, trip.id, "start")).status).toBe(200);
  });

  it("refuses illegal moves with the current status", async () => {
    const { trip } = await bookedTrip(site, world);
    const cases: [string, string][] = [
      ["start", "PENDING"],
      ["end", "PENDING"],
      ["complete", "PENDING"],
      ["unstart", "PENDING"],
      ["reopen", "PENDING"],
    ];
    for (const [action, status] of cases) {
      const response = await act(staff, trip.id, action);
      expect(response.status).toBe(409);
      expect(await problem(response)).toMatchObject({
        code: "TRIP_STATUS_CONFLICT",
        tripStatus: status,
      });
    }
    await act(staff, trip.id, "confirm");
    expect((await problem(await act(staff, trip.id, "confirm"))).tripStatus).toBe("CONFIRMED");
    expect((await act(staff, "missing", "confirm")).status).toBe(404);

    await act(staff, trip.id, "cancel", { reason: "DUPLICATE" });
    for (const action of ["confirm", "start", "cancel"]) {
      const response = await act(staff, trip.id, action, { reason: "DUPLICATE" });
      expect(await problem(response)).toMatchObject({ tripStatus: "CANCELLED" });
    }
  });

  it("lets only one of two simultaneous moves win", async () => {
    const { trip } = await bookedTrip(site, world);
    const [first, second] = await Promise.all([
      act(staff, trip.id, "confirm"),
      act(staff, trip.id, "confirm"),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(await events(trip.id)).toHaveLength(2);
  });

  it("confirms only a quoted or accepted price", async () => {
    const { trip } = await bookedTrip(site, world, {
      classId: world.vip.id,
      expectedPrice: undefined,
    });
    const response = await act(staff, trip.id, "confirm");
    expect(response.status).toBe(409);
    expect((await problem(response)).code).toBe("PRICE_NOT_ACCEPTED");
  });

  it("cancels pending, confirmed or in-progress trips with a reason", async () => {
    const { trip } = await bookedTrip(site, world);
    expect((await act(staff, trip.id, "cancel", { reason: "OTHER" })).status).toBe(400);
    expect((await act(staff, trip.id, "cancel", { reason: "LOST" })).status).toBe(400);

    await act(staff, trip.id, "confirm");
    const { driver, vehicle } = await fleet();
    await prisma.trip.update({
      where: { id: trip.id },
      data: { driverId: driver.id, vehicleId: vehicle.id },
    });
    await act(staff, trip.id, "start");
    const response = await act(staff, trip.id, "cancel", {
      reason: "OTHER",
      note: "Breakdown on the road",
    });
    expect(await json<TripBody>(response)).toMatchObject({ status: "CANCELLED" });
    expect((await events(trip.id)).at(-1)).toMatchObject({
      action: "trip.cancelled",
      data: {
        from: "IN_PROGRESS",
        to: "CANCELLED",
        reason: "OTHER",
        note: "Breakdown on the road",
      },
    });
  });

  it("cancels only the leg staff choose", async () => {
    const { trip, returnTrip } = await bookedTrip(site, world, {
      return: { pickupDate: pickupIn(72).toISOString(), expectedPrice: "1400" },
    });
    await act(staff, trip.id, "cancel", { reason: "CUSTOMER_REQUEST" });
    expect(await statusOf(returnTrip?.id ?? "")).toBe("PENDING");
  });

  it("undoes a start and reopens a completed trip until its month's report exists", async () => {
    const { trip } = await bookedTrip(site, world);
    const { driver, vehicle } = await fleet();
    await prisma.trip.update({
      where: { id: trip.id },
      data: { status: "IN_PROGRESS", driverId: driver.id, vehicleId: vehicle.id },
    });
    const undone = await act(staff, trip.id, "unstart");
    expect(await json<TripBody>(undone)).toMatchObject({ status: "CONFIRMED" });
    expect((await events(trip.id)).at(-1)).toMatchObject({
      action: "trip.start_undone",
      data: { from: "IN_PROGRESS", to: "CONFIRMED" },
    });

    await prisma.trip.update({ where: { id: trip.id }, data: { status: "COMPLETED" } });
    const reopened = await act(staff, trip.id, "reopen");
    expect(await json<TripBody>(reopened)).toMatchObject({ status: "AWAITING_REPORT" });

    await prisma.trip.update({
      where: { id: trip.id },
      data: { status: "COMPLETED", pickupDate: new Date("2026-10-31T22:30:00Z") },
    });
    // 00:30 on 1 November in Cairo: November's report.
    await prisma.analyticsDocument.create({
      data: { bucket: "b", key: "reports/2026-11.xlsx", year: 2026, month: 11, size: 1 },
    });
    const refused = await act(staff, trip.id, "reopen");
    expect(refused.status).toBe(409);
    expect((await problem(refused)).code).toBe("MONTH_REPORT_GENERATED");
  });

  it("refuses a second trip in progress for the same driver", async () => {
    const { trip } = await bookedTrip(site, world);
    const { trip: other } = await bookedTrip(site, world);
    const { driver, vehicle } = await fleet();
    const spare = await fleet();
    await prisma.trip.update({
      where: { id: trip.id },
      data: { status: "IN_PROGRESS", driverId: driver.id, vehicleId: vehicle.id },
    });
    await prisma.trip.update({
      where: { id: other.id },
      data: { status: "CONFIRMED", driverId: driver.id, vehicleId: spare.vehicle.id },
    });
    const response = await act(staff, other.id, "start");
    expect(response.status).toBe(409);
    expect(await problem(response)).toMatchObject({ code: "ASSIGNEE_BUSY", field: "driver" });
  });
});

describe("cancelling on the site", () => {
  let world: TripWorld;
  beforeEach(async () => {
    world = await tripWorld();
  });

  const cancel = (agent: Agent, id: string, body: unknown = {}) =>
    agent.request(`/v1/site/trips/${id}/cancel`, { method: "POST", json: body });

  it("cancels a pending trip, with the booker as the actor", async () => {
    const { customer, agent } = await signedInCustomer();
    const { trip } = await bookedTrip(agent, world);
    const response = await cancel(agent, trip.id, { reason: "Plans changed" });
    expect(response.status).toBe(200);
    expect(await json<{ data: TripBody[] }>(response)).toMatchObject({
      data: [{ id: trip.id, status: "CANCELLED" }],
    });
    expect((await events(trip.id)).at(-1)).toMatchObject({
      action: "trip.cancelled",
      customerId: customer.id,
      data: { reason: "CUSTOMER_REQUEST", note: "Plans changed" },
    });
  });

  it("never cancels a confirmed trip online", async () => {
    const { agent } = await signedInCustomer();
    const { agent: staff } = await tripsStaff();
    const { trip } = await bookedTrip(agent, world);
    await act(staff, trip.id, "confirm");
    const response = await cancel(agent, trip.id);
    expect(response.status).toBe(409);
    expect((await problem(response)).code).toBe("CALL_TO_CANCEL");
    expect(await statusOf(trip.id)).toBe("CONFIRMED");
  });

  it("cancels the whole booking, or only the return once the outbound started", async () => {
    const { agent } = await signedInCustomer();
    const both = await bookedTrip(agent, world, {
      return: { pickupDate: pickupIn(72).toISOString(), expectedPrice: "1400" },
    });
    // Cancelling the return takes the outbound with it.
    const response = await cancel(agent, both.returnTrip?.id ?? "");
    expect((await json<{ data: TripBody[] }>(response)).data.map((trip) => trip.id)).toEqual([
      both.trip.id,
      both.returnTrip?.id,
    ]);

    const started = await bookedTrip(agent, world, {
      return: { pickupDate: pickupIn(72).toISOString(), expectedPrice: "1400" },
    });
    await prisma.trip.update({ where: { id: started.trip.id }, data: { status: "IN_PROGRESS" } });
    const onlyReturn = await cancel(agent, started.returnTrip?.id ?? "");
    expect((await json<{ data: TripBody[] }>(onlyReturn)).data.map((trip) => trip.id)).toEqual([
      started.returnTrip?.id,
    ]);
    expect(await statusOf(started.trip.id)).toBe("IN_PROGRESS");
  });

  it("won't cancel a booking with a confirmed leg", async () => {
    const { agent } = await signedInCustomer();
    const { trip, returnTrip } = await bookedTrip(agent, world, {
      return: { pickupDate: pickupIn(72).toISOString(), expectedPrice: "1400" },
    });
    await prisma.trip.update({ where: { id: trip.id }, data: { status: "CONFIRMED" } });
    const response = await cancel(agent, returnTrip?.id ?? "");
    expect((await problem(response)).code).toBe("CALL_TO_CANCEL");
    expect(await statusOf(returnTrip?.id ?? "")).toBe("PENDING");
  });

  it("lets a guest cancel a trip booked from another session with the same email", async () => {
    const first = await verifiedGuest("karim@example.com");
    const later = await verifiedGuest("karim@example.com");
    const { trip } = await bookedTrip(first.agent, world);
    const response = await cancel(later.agent, trip.id);
    expect(response.status).toBe(200);
    expect((await events(trip.id)).at(-1)).toMatchObject({ guestSessionId: later.session.id });

    const stranger = await verifiedGuest("someone@example.com");
    expect((await cancel(stranger.agent, trip.id)).status).toBe(404);
  });
});

describe("price on request", () => {
  let world: TripWorld;
  let staff: Agent;
  beforeEach(async () => {
    world = await tripWorld();
    staff = (await tripsStaff(["trips"])).agent;
  });

  const unpriced = { classId: undefined as string | undefined, expectedPrice: undefined };
  const propose = (id: string, body: unknown) =>
    staff.request(`/v1/staff/trips/${id}/price`, { method: "POST", json: body });
  const answer = (agent: Agent, id: string, verb: "accept" | "decline", body: unknown = {}) =>
    agent.request(`/v1/site/trips/${id}/price/${verb}`, { method: "POST", json: body });

  it("goes requested, proposed, re-proposed, accepted, then confirmable", async () => {
    const { customer, agent } = await signedInCustomer();
    const { trip } = await bookedTrip(agent, world, { ...unpriced, classId: world.vip.id });

    expect((await answer(agent, trip.id, "accept", { expectedPrice: "100" })).status).toBe(409);

    const proposed = await propose(trip.id, { totalPrice: "2000", note: "Long route" });
    expect(await json<TripBody>(proposed)).toMatchObject({
      priceState: "PROPOSED",
      totalPrice: "2000.00",
    });
    await propose(trip.id, { totalPrice: "1900" });
    expect((await act(staff, trip.id, "confirm")).status).toBe(409);

    const stale = await answer(agent, trip.id, "accept", { expectedPrice: "2000" });
    expect(stale.status).toBe(409);
    expect(await problem(stale)).toMatchObject({ code: "PRICE_CHANGED", price: "1900.00" });

    const accepted = await answer(agent, trip.id, "accept", { expectedPrice: "1900" });
    expect(accepted.status).toBe(200);
    expect(await json<{ data: TripBody[] }>(accepted)).toMatchObject({
      data: [{ id: trip.id, priceState: "ACCEPTED", totalPrice: "1900.00" }],
    });
    expect((await events(trip.id)).map((event) => event.action)).toEqual([
      "trip.created",
      "trip.price_proposed",
      "trip.price_proposed",
      "trip.price_accepted",
    ]);
    expect((await events(trip.id)).at(-1)).toMatchObject({ customerId: customer.id });

    expect((await propose(trip.id, { totalPrice: "1800" })).status).toBe(409);
    expect((await act(staff, trip.id, "confirm")).status).toBe(200);
  });

  it("accepts every proposed leg at once, by their total", async () => {
    const { agent } = await signedInCustomer();
    const { trip, returnTrip } = await bookedTrip(agent, world, {
      ...unpriced,
      classId: world.vip.id,
      return: { pickupDate: pickupIn(72).toISOString() },
    });
    await propose(trip.id, { totalPrice: "2000" });
    await propose(returnTrip?.id ?? "", { totalPrice: "1800" });

    expect((await answer(agent, trip.id, "accept", { expectedPrice: "2000" })).status).toBe(409);
    const accepted = await answer(agent, returnTrip?.id ?? "", "accept", {
      expectedPrice: "3800",
    });
    expect((await json<{ data: TripBody[] }>(accepted)).data.map((leg) => leg.priceState)).toEqual([
      "ACCEPTED",
      "ACCEPTED",
    ]);
  });

  it("declining cancels the trip, and declining the outbound cancels the return", async () => {
    const { agent } = await verifiedGuest();
    const { trip, returnTrip } = await bookedTrip(agent, world, {
      ...unpriced,
      classId: world.vip.id,
      return: { pickupDate: pickupIn(72).toISOString() },
    });
    expect((await answer(agent, trip.id, "decline")).status).toBe(409);
    await propose(trip.id, { totalPrice: "2000" });
    const declined = await answer(agent, trip.id, "decline", { reason: "Too expensive" });
    expect(declined.status).toBe(200);
    expect(await statusOf(trip.id)).toBe("CANCELLED");
    expect(await statusOf(returnTrip?.id ?? "")).toBe("CANCELLED");
    expect((await events(trip.id)).at(-1)).toMatchObject({
      action: "trip.price_declined",
      data: { from: "PENDING", to: "CANCELLED", reason: "PRICE_DECLINED", note: "Too expensive" },
    });
  });

  it("declining the return keeps the outbound", async () => {
    const { agent } = await signedInCustomer();
    const { trip, returnTrip } = await bookedTrip(agent, world, {
      return: {
        pickupDate: pickupIn(72).toISOString(),
        pickup: { latitude: 31.5, longitude: 29.6 },
      },
    });
    await propose(returnTrip?.id ?? "", { totalPrice: "1300" });
    await answer(agent, returnTrip?.id ?? "", "decline");
    expect(await statusOf(trip.id)).toBe("PENDING");
    expect(await statusOf(returnTrip?.id ?? "")).toBe("CANCELLED");
  });

  it("accepts a staff booking's price at once, and saves to the price list with pricing", async () => {
    const { customer } = await signedInCustomer();
    const booked = await json<Booked>(
      await staffBook(staff, {
        classId: world.vip.id,
        car: "SEDAN",
        pickup: { latitude: 29.96, longitude: 31.26 },
        dropoff: { latitude: 31.2, longitude: 29.95 },
        pickupDate: pickupIn(24).toISOString(),
        passengers: 1,
        customerId: customer.id,
      }),
    );
    // Booked for a customer: the customer answers, so it's proposed.
    expect(
      await json<TripBody>(await propose(booked.trip.id, { totalPrice: "2100" })),
    ).toMatchObject({ priceState: "PROPOSED" });

    const forbidden = await propose(booked.trip.id, { totalPrice: "2100", saveToPricing: true });
    expect(forbidden.status).toBe(403);

    const pricing = (await tripsStaff(["trips", "pricing"], "pricing@terhal.co")).agent;
    const saved = await pricing.request(`/v1/staff/trips/${booked.trip.id}/price`, {
      method: "POST",
      json: { totalPrice: "2200", saveToPricing: true },
    });
    expect(saved.status).toBe(200);
    expect(
      await prisma.pricing.findFirstOrThrow({
        where: { fromId: world.degla.id, toId: world.smouha.id, classId: world.vip.id },
      }),
    ).toMatchObject({ car: "SEDAN" });
    expect(await prisma.auditLog.count({ where: { action: "pricing.created" } })).toBe(1);

    // A staff member's own booking: they agreed on the phone.
    await prisma.trip.update({
      where: { id: booked.trip.id },
      data: {
        customerId: null,
        staffId: (await prisma.staff.findFirstOrThrow()).id,
        priceState: "REQUESTED",
        totalPrice: null,
      },
    });
    expect(
      await json<TripBody>(await propose(booked.trip.id, { totalPrice: "2100" })),
    ).toMatchObject({ priceState: "ACCEPTED" });
  });
});
