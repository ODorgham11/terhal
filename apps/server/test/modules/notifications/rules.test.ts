import { tripEventActions as a } from "@terhal/contracts";
import { describe, expect, it } from "vitest";
import {
  planNotifications,
  reminderDue,
  reminderSchedule,
  reminderStillDue,
  type TripFacts,
} from "../../../src/modules/notifications/domain/rules";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-12-01T10:00:00Z");
const pickup = new Date(now.getTime() + 48 * HOUR);

const trip = (overrides: Partial<TripFacts> = {}): TripFacts => ({
  status: "PENDING",
  priceState: "QUOTED",
  source: "CUSTOMER",
  booker: "customer",
  pickupDate: pickup,
  hasDriver: false,
  hasVehicle: false,
  hasOffice: false,
  ...overrides,
});

const customer = { customerId: "c1" };
const guest = { guestSessionId: "g1" };
const staff = { staffId: "s1" };
const system = { system: "expire-pending-trips" };
const driver = { driverId: "d1" };

describe("who is told what (N1)", () => {
  it("tells the booker and staff of a booking on the site", () => {
    expect(planNotifications({ action: a.CREATED, actor: customer }, trip())).toEqual({
      booker: "BOOKING_RECEIVED",
      staff: "NEW_BOOKING",
    });
    expect(
      planNotifications({ action: a.CREATED, actor: guest }, trip({ priceState: "REQUESTED" })),
    ).toEqual({ booker: "BOOKING_RECEIVED", staff: "PRICE_REQUESTED" });
  });

  it("emails a customer booked for by staff, and tells no one of a staff member's own booking", () => {
    expect(
      planNotifications({ action: a.CREATED, actor: staff }, trip({ source: "STAFF" })),
    ).toEqual({ booker: "BOOKED_BY_STAFF", staff: null });
    expect(
      planNotifications(
        { action: a.CREATED, actor: staff },
        trip({ source: "STAFF", booker: "staff" }),
      ),
    ).toEqual({ booker: null, staff: null });
    // Unpriced, the rest of the team hears of it.
    expect(
      planNotifications(
        { action: a.CREATED, actor: staff },
        trip({ source: "STAFF", priceState: "REQUESTED" }),
      ).staff,
    ).toBe("PRICE_REQUESTED");
  });

  it("sends the driver's details only once the trip is confirmed (A6 a)", () => {
    const assigned = { hasDriver: true, hasVehicle: true };
    expect(
      planNotifications({ action: a.ASSIGNED, actor: staff }, trip(assigned)).booker,
    ).toBeNull();
    expect(
      planNotifications(
        { action: a.ASSIGNED, actor: staff },
        trip({ ...assigned, status: "CONFIRMED" }),
      ).booker,
    ).toBe("DRIVER_ASSIGNED");
    expect(planNotifications({ action: a.CONFIRMED, actor: staff }, trip()).booker).toBe(
      "TRIP_CONFIRMED",
    );
  });

  it("tells who should know of each cancellation", () => {
    const cancelled = trip({ status: "CANCELLED" });
    expect(planNotifications({ action: a.CANCELLED, actor: staff }, cancelled)).toEqual({
      booker: "TRIP_CANCELLED",
      staff: null,
    });
    expect(planNotifications({ action: a.CANCELLED, actor: system }, cancelled)).toEqual({
      booker: "TRIP_CANCELLED",
      staff: "CANCELLED_BY_SYSTEM",
    });
    expect(planNotifications({ action: a.CANCELLED, actor: customer }, cancelled)).toEqual({
      booker: "CANCELLATION_RECEIPT",
      staff: "CANCELLED_BY_BOOKER",
    });
    expect(planNotifications({ action: a.PRICE_DECLINED, actor: guest }, cancelled)).toEqual({
      booker: "CANCELLATION_RECEIPT",
      staff: "PRICE_DECLINED",
    });
    // The return leg going with a declined outbound: staff already know.
    expect(
      planNotifications(
        { action: a.CANCELLED, actor: guest, data: { withTripId: "t1" } },
        cancelled,
      ).staff,
    ).toBeNull();
  });

  it("covers prices, completion and the driver's report", () => {
    expect(
      planNotifications(
        { action: a.PRICE_PROPOSED, actor: staff },
        trip({ priceState: "PROPOSED" }),
      ).booker,
    ).toBe("PRICE_PROPOSED");
    // Accepted on the phone: nothing to ask.
    expect(
      planNotifications(
        { action: a.PRICE_PROPOSED, actor: staff },
        trip({ priceState: "ACCEPTED" }),
      ).booker,
    ).toBeNull();
    expect(planNotifications({ action: a.PRICE_ACCEPTED, actor: customer }, trip()).staff).toBe(
      "PRICE_ACCEPTED",
    );
    expect(planNotifications({ action: a.COMPLETED, actor: staff }, trip()).booker).toBe(
      "TRIP_COMPLETED",
    );
    expect(planNotifications({ action: a.REPORT_SUBMITTED, actor: driver }, trip())).toEqual({
      booker: null,
      staff: "REPORT_SUBMITTED",
    });
    // A driver starting or ending through the report link, or a report edit or link: nobody is told.
    for (const action of [a.STARTED, a.ENDED, a.REPORT_EDITED, a.REPORT_LINK_ISSUED]) {
      expect(planNotifications({ action, actor: driver }, trip())).toEqual({
        booker: null,
        staff: null,
      });
    }
    expect(planNotifications({ action: a.UPDATED, actor: staff }, trip())).toEqual({
      booker: null,
      staff: null,
    });
  });
});

describe("reminders (N4)", () => {
  it("are due 24 hours before a confirmed pickup, and 2 hours before one still unassigned", () => {
    const confirmed = trip({ status: "CONFIRMED" });
    expect(reminderDue("PICKUP", confirmed)).toEqual(new Date(pickup.getTime() - 24 * HOUR));
    expect(reminderDue("PICKUP", trip())).toBeNull();
    expect(reminderDue("PICKUP", trip({ status: "CONFIRMED", booker: "staff" }))).toBeNull();
    expect(reminderDue("UNASSIGNED", confirmed)).toEqual(new Date(pickup.getTime() - 2 * HOUR));
    expect(reminderDue("UNASSIGNED", trip({ hasOffice: true }))).toBeNull();
    expect(reminderDue("UNASSIGNED", trip({ hasDriver: true }))).not.toBeNull();
    expect(reminderDue("UNASSIGNED", trip({ status: "CANCELLED" }))).toBeNull();
    expect(reminderDue("PRICE", trip({ priceState: "PROPOSED" }))).toEqual(
      new Date(pickup.getTime() - 24 * HOUR),
    );
    expect(reminderDue("PRICE", trip({ priceState: "ACCEPTED" }))).toBeNull();
  });

  it("drop a booker reminder already past, but still warn staff of an unassigned trip", () => {
    const soon = trip({ status: "CONFIRMED", pickupDate: new Date(now.getTime() + HOUR) });
    expect(reminderSchedule("PICKUP", soon, now)).toBeNull();
    expect(reminderSchedule("UNASSIGNED", soon, now)).toEqual(
      new Date(soon.pickupDate.getTime() - 2 * HOUR),
    );
    const gone = trip({ pickupDate: new Date(now.getTime() - HOUR) });
    expect(reminderSchedule("UNASSIGNED", gone, now)).toBeNull();
  });

  it("send only for the time the trip still calls for, before its pickup", () => {
    const confirmed = trip({ status: "CONFIRMED" });
    const due = new Date(pickup.getTime() - 24 * HOUR);
    expect(reminderStillDue("PICKUP", confirmed, due, due)).toBe(true);
    // The pickup moved.
    expect(reminderStillDue("PICKUP", confirmed, new Date(due.getTime() - HOUR), due)).toBe(false);
    expect(reminderStillDue("PICKUP", trip({ status: "CANCELLED" }), due, due)).toBe(false);
    expect(reminderStillDue("PICKUP", confirmed, due, new Date(pickup.getTime() + 1))).toBe(false);
  });
});
