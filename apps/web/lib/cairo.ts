// Trips run on Cairo time whatever the browser's zone: "today" on the dashboard is the Cairo day, like the API's
// overview counts.
export const CAIRO = "Africa/Cairo";

// Cairo's offset from UTC at an instant, in minutes (120 in winter, 180 in summer time).
const offsetAt = (instant: Date) => {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: CAIRO, timeZoneName: "longOffset" })
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? "");
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
};

// The Cairo calendar date of an instant, as numbers.
const cairoDate = (instant: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CAIRO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
};

// Midnight in Cairo at the start of the day `days` after the one `instant` falls on.
export const startOfCairoDay = (instant = new Date(), days = 0) => {
  const { year, month, day } = cairoDate(instant);
  const utcMidnight = Date.UTC(year, month - 1, day + days);
  // The offset at that midnight (close enough: Egypt changes its clocks at midnight or later).
  return new Date(utcMidnight - offsetAt(new Date(utcMidnight)) * 60_000);
};

// The hour of the day in Cairo, 0–23.
export const cairoHour = (instant = new Date()) =>
  Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: CAIRO, hour: "2-digit", hour12: false }).format(
      instant,
    ),
  ) % 24;
