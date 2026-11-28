// Pickup times are typed as Cairo wall-clock time, whatever the browser's zone, and sent as instants.

const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// "2026-12-03" and "08:00" in Cairo, for an instant.
export function cairoParts(instant: Date) {
  const get = (type: string) =>
    parts.formatToParts(instant).find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

// The instant a Cairo date and time names. Egypt's offset changes with daylight saving, so the guess is corrected by
// the offset Cairo actually had then; a second pass settles the hour around the switch.
export function cairoInstant(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const wanted = Date.parse(`${date}T${time}:00Z`);
  let instant = wanted;
  for (let pass = 0; pass < 2; pass++) {
    const shown = cairoParts(new Date(instant));
    const drift = Date.parse(`${shown.date}T${shown.time}:00Z`) - wanted;
    instant -= drift;
  }
  return new Date(instant);
}
