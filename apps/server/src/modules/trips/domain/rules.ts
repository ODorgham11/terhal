import {
  ASSIGNMENT_CONFLICT_HOURS,
  BOOKING_HORIZON_DAYS,
  BOOKING_LEAD_HOURS,
  OVERDUE_AFTER_HOURS,
  PICKUP_GRID_MINUTES,
  type TripStatus,
} from "@terhal/contracts";

// The trip rules that need no database: pickup times, codes, Cairo's calendar, what counts as assigned.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Trips that still need a driver, a vehicle or an office, and that a soft conflict counts (A3).
export const LIVE_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
] as const satisfies TripStatus[];

// Where staff can still edit a trip's details (B10 a), and its price and payment (until completed).
export const EDITABLE_STATUSES = ["PENDING", "CONFIRMED"] as const satisfies TripStatus[];
export const PRICE_EDITABLE_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
  "AWAITING_REPORT",
] as const satisfies TripStatus[];

export type PickupProblem = "TOO_SOON" | "TOO_FAR" | "OFF_GRID" | "IN_PAST";

// On the 15-minute grid. Cairo's offset from UTC is a whole number of hours, so a quarter hour in UTC is one in Cairo.
const onGrid = (pickup: Date) =>
  pickup.getUTCSeconds() === 0 &&
  pickup.getUTCMilliseconds() === 0 &&
  pickup.getUTCMinutes() % PICKUP_GRID_MINUTES === 0;

// Customers and guests (B2 a): at least 3 hours ahead, at most 90 days ahead, on a quarter hour.
export const onlinePickupProblem = (pickup: Date, now: Date): PickupProblem | null => {
  if (!onGrid(pickup)) return "OFF_GRID";
  if (pickup.getTime() < now.getTime() + BOOKING_LEAD_HOURS * HOUR) return "TOO_SOON";
  if (pickup.getTime() > now.getTime() + BOOKING_HORIZON_DAYS * DAY) return "TOO_FAR";
  return null;
};

// Staff (B2 a): any future time, and the past only when they say it's backdated.
export const staffPickupProblem = (
  pickup: Date,
  now: Date,
  backdated: boolean,
): PickupProblem | null => (pickup.getTime() <= now.getTime() && !backdated ? "IN_PAST" : null);

// Trip codes (B7 a): a prefix and 6 characters without look-alikes (no 0/O, 1/I/L).
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 6;
export const codeFrom = (indexes: readonly number[]) =>
  `TRH-${indexes.map((index) => CODE_ALPHABET.charAt(index)).join("")}`;

// The window around a pickup in which another live trip of the same driver or vehicle is a conflict (A3: ±3 hours).
export const conflictWindow = (pickup: Date) => ({
  from: new Date(pickup.getTime() - ASSIGNMENT_CONFLICT_HOURS * HOUR),
  to: new Date(pickup.getTime() + ASSIGNMENT_CONFLICT_HOURS * HOUR),
});

// The latest pickup of a trip the overdue job advances (T3 d: 12 hours after its pickup).
export const overdueBefore = (now: Date) => new Date(now.getTime() - OVERDUE_AFTER_HOURS * HOUR);
// When a trip picked up at `pickupDate` becomes overdue: the other side of overdueBefore.
export const overdueAt = (pickupDate: Date) =>
  new Date(pickupDate.getTime() + OVERDUE_AFTER_HOURS * HOUR);

// A driver and a vehicle, or an office (T2 a, A4 a).
export const isAssigned = (trip: {
  driverId: string | null;
  vehicleId: string | null;
  officeId: string | null;
}) => trip.officeId !== null || (trip.driverId !== null && trip.vehicleId !== null);

// --- Cairo's calendar (X4) ---

const cairoFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

// The wall clock in Cairo at an instant.
export const cairoParts = (instant: Date) => {
  const parts = Object.fromEntries(
    cairoFormat.formatToParts(instant).map((part) => [part.type, Number(part.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  return parts;
};

// Minutes Cairo is ahead of UTC at an instant.
const cairoOffset = (instant: Date) => {
  const { year, month, day, hour, minute, second } = cairoParts(instant);
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  return Math.round((wall - Math.floor(instant.getTime() / 1000) * 1000) / MINUTE);
};

// The instant a Cairo day starts, `days` days after the one holding `instant`.
export const cairoDayStart = (instant: Date, days = 0) => {
  const { year, month, day } = cairoParts(instant);
  const midnight = Date.UTC(year, month - 1, day + days);
  // The offset can differ on either side of a change, so check it at the result.
  const first = midnight - cairoOffset(new Date(midnight)) * MINUTE;
  return new Date(midnight - cairoOffset(new Date(first)) * MINUTE);
};

// The Cairo month a pickup falls in, for the monthly report.
export const cairoMonth = (instant: Date) => {
  const { year, month } = cairoParts(instant);
  return { year, month };
};
