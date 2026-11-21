import {
  tripEventActions,
  type BookerNotificationKind,
  type NotificationKind,
  type TripEventAction,
  type TripPriceState,
  type TripStatus,
} from "@terhal/contracts";

// Who is told what (N1): pure functions from a trip event and the trip as it is afterwards to the notifications it
// causes, and when a trip's reminders are due.

export type StaffNotificationKind = Exclude<NotificationKind, BookerNotificationKind>;

export type EventActor =
  | { staffId: string }
  | { customerId: string }
  | { guestSessionId: string }
  | { system: string };

// What the rules need to know about the trip, after the event.
export interface TripFacts {
  status: TripStatus;
  priceState: TripPriceState;
  source: "CUSTOMER" | "STAFF";
  // Who booked it. Only a customer or a guest has an email to be told at (a staff member's own booking has none).
  booker: "customer" | "guest" | "staff";
  pickupDate: Date;
  hasDriver: boolean;
  hasVehicle: boolean;
  hasOffice: boolean;
}

export interface EventNotice {
  action: TripEventAction;
  actor: EventActor;
  data?: Record<string, unknown> | null;
}

export interface Planned {
  // Emailed to the booker.
  booker: BookerNotificationKind | null;
  // In-app, to every active staff member with `trips` except the one who acted.
  staff: StaffNotificationKind | null;
}

const byBooker = (actor: EventActor) => "customerId" in actor || "guestSessionId" in actor;

// Assigned enough to show the booker something (A6 a): a driver, a vehicle or an office.
export const hasAssignment = (trip: TripFacts) => trip.hasDriver || trip.hasVehicle || trip.hasOffice;

// Assigned enough to start (T2 a): an office, or a driver and a vehicle.
export const isAssigned = (trip: TripFacts) => trip.hasOffice || (trip.hasDriver && trip.hasVehicle);

const none: Planned = { booker: null, staff: null };

const forEvent = (event: EventNotice, trip: TripFacts): Planned => {
  switch (event.action) {
    // Staff hear of bookings made on the site, and of any booking still without a price (a staff member's booking for
    // a customer, too: the rest of the team may price it).
    case tripEventActions.CREATED:
      return {
        booker: trip.source === "CUSTOMER" ? "BOOKING_RECEIVED" : "BOOKED_BY_STAFF",
        staff:
          trip.priceState === "REQUESTED"
            ? "PRICE_REQUESTED"
            : byBooker(event.actor)
              ? "NEW_BOOKING"
              : null,
      };
    case tripEventActions.CONFIRMED:
      return { booker: "TRIP_CONFIRMED", staff: null };
    // A6 a: the details are shown once the trip is confirmed; before that, confirming sends them.
    case tripEventActions.ASSIGNED:
      return {
        booker: trip.status === "CONFIRMED" && hasAssignment(trip) ? "DRIVER_ASSIGNED" : null,
        staff: null,
      };
    // A booker staff answered for on the phone goes straight to ACCEPTED: nothing to ask.
    case tripEventActions.PRICE_PROPOSED:
      return { booker: trip.priceState === "PROPOSED" ? "PRICE_PROPOSED" : null, staff: null };
    case tripEventActions.PRICE_ACCEPTED:
      return { booker: null, staff: "PRICE_ACCEPTED" };
    case tripEventActions.PRICE_DECLINED:
      return { booker: "CANCELLATION_RECEIPT", staff: "PRICE_DECLINED" };
    case tripEventActions.CANCELLED: {
      if ("system" in event.actor) return { booker: "TRIP_CANCELLED", staff: "CANCELLED_BY_SYSTEM" };
      if ("staffId" in event.actor) return { booker: "TRIP_CANCELLED", staff: null };
      // The return leg cancelled with a declined outbound (R3 a): staff already have PRICE_DECLINED for it.
      const withDecline = event.data?.withTripId !== undefined;
      return { booker: "CANCELLATION_RECEIPT", staff: withDecline ? null : "CANCELLED_BY_BOOKER" };
    }
    case tripEventActions.COMPLETED:
      return { booker: "TRIP_COMPLETED", staff: null };
    case tripEventActions.REPORT_SUBMITTED:
      return { booker: null, staff: "REPORT_SUBMITTED" };
    default:
      return none;
  }
};

export const planNotifications = (event: EventNotice, trip: TripFacts): Planned => {
  const planned = forEvent(event, trip);
  return trip.booker === "staff" ? { ...planned, booker: null } : planned;
};

// --- Reminders (N4): delayed jobs, recomputed from the trip on every event ---

export const reminderKinds = ["PICKUP", "PRICE", "UNASSIGNED"] as const;
export type ReminderKind = (typeof reminderKinds)[number];

const HOUR = 60 * 60 * 1000;

const leadTime: Record<ReminderKind, number> = {
  PICKUP: 24 * HOUR,
  PRICE: 24 * HOUR,
  UNASSIGNED: 2 * HOUR,
};

const applies: Record<ReminderKind, (trip: TripFacts) => boolean> = {
  PICKUP: (trip) => trip.booker !== "staff" && trip.status === "CONFIRMED",
  PRICE: (trip) =>
    trip.booker !== "staff" && trip.status === "PENDING" && trip.priceState === "PROPOSED",
  UNASSIGNED: (trip) =>
    (trip.status === "PENDING" || trip.status === "CONFIRMED") && !isAssigned(trip),
};

// When the reminder is due for the trip as it is, whatever the time now; null when it doesn't apply.
export const reminderDue = (kind: ReminderKind, trip: TripFacts): Date | null =>
  applies[kind](trip) ? new Date(trip.pickupDate.getTime() - leadTime[kind]) : null;

// When to schedule it now. One already past is dropped, except that staff still hear about an unassigned trip that
// hasn't picked up yet (a late booking or a driver taken off it), at once.
export const reminderSchedule = (kind: ReminderKind, trip: TripFacts, now: Date): Date | null => {
  const due = reminderDue(kind, trip);
  if (!due) return null;
  if (due > now) return due;
  return kind === "UNASSIGNED" && trip.pickupDate > now ? due : null;
};

// Whether a reminder job due at `dueAt` should still send: the trip still calls for that very reminder, and hasn't
// picked up yet (a worker that was down doesn't send stale ones).
export const reminderStillDue = (kind: ReminderKind, trip: TripFacts, dueAt: Date, now: Date) =>
  reminderDue(kind, trip)?.getTime() === dueAt.getTime() && now < trip.pickupDate;

export const reminderNotification = {
  PICKUP: { booker: "TRIP_REMINDER", staff: null },
  PRICE: { booker: "PRICE_REMINDER", staff: null },
  UNASSIGNED: { booker: null, staff: "TRIP_UNASSIGNED" },
} as const satisfies Record<ReminderKind, Planned>;
