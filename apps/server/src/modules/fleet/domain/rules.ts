import { LICENSE_EXPIRY_WARNING_DAYS, normalizeSearch } from "@terhal/contracts";

// Trips that still need their driver, vehicle or office: archiving any of them is blocked while it's on one. Past the
// pickup time a trip can still be pending or confirmed until the background jobs move it on, and that still counts.
export const LIVE_TRIP_STATUSES = ["PENDING", "CONFIRMED", "IN_PROGRESS"] as const;

const DAY = 24 * 60 * 60 * 1000;

// Today's date in Cairo, as YYYY-MM-DD: business days are Cairo's (docs/decisions.md).
export const cairoDate = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

// The last licence expiry date that gets flagged: today in Cairo plus the warning period. A licence that has already
// expired is flagged too.
export const licenseWarningDate = (now: Date) => {
  const today = new Date(`${cairoDate(now)}T00:00:00Z`);
  return new Date(today.getTime() + LICENSE_EXPIRY_WARNING_DAYS * DAY);
};

export const licenseExpiresSoon = (expiresAt: Date | null, now: Date) =>
  expiresAt !== null && expiresAt.getTime() <= licenseWarningDate(now).getTime();

// What people typed, normalized like the search columns (alef forms, taa marbuta, digits...) and split into words, each
// matched with a case-insensitive contains. Drivers, vehicles and offices have no search column, so only the input is
// normalized.
export const searchWords = (q: string | undefined) =>
  q ? normalizeSearch(q).split(" ").filter(Boolean) : [];
