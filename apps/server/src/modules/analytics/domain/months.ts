// Cairo's calendar months, for the monthly report (X4: business time is Cairo's).

export interface Month {
  year: number;
  month: number;
}

const cairoDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// The Cairo calendar day at an instant, as YYYY-MM-DD.
export const cairoDay = (instant: Date) => cairoDate.format(instant);

const cairoClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// The Cairo wall clock at an instant, as "YYYY-MM-DD HH:mm", for people reading a spreadsheet.
export const cairoWallClock = (instant: Date) => {
  const part = Object.fromEntries(
    cairoClock.formatToParts(instant).map(({ type, value }) => [type, value]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute", string>;
  return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}`;
};

// The instant a Cairo day (YYYY-MM-DD) starts. Midnight UTC that day, moved back by Cairo's offset; the offset is read
// again at the result, in case the guess fell on the other side of a clock change.
export const cairoDayStart = (day: string) => {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  const midnight = Date.UTC(year, month - 1, date);
  const offset = (instant: number) => {
    const wall = cairoWallClock(new Date(instant));
    return Date.parse(`${wall.replace(" ", "T")}:00Z`) - Math.floor(instant / 60_000) * 60_000;
  };
  const first = midnight - offset(midnight);
  return new Date(midnight - offset(first));
};

// The Cairo month an instant falls in.
export const cairoMonthOf = (instant: Date): Month => {
  const [year = "0", month = "0"] = cairoDay(instant).split("-");
  return { year: Number(year), month: Number(month) };
};

export const previousMonth = ({ year, month }: Month): Month =>
  month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };

// A month is over once Cairo has reached a later month.
export const isMonthOver = (target: Month, now: Date) => {
  const current = cairoMonthOf(now);
  return target.year * 12 + target.month < current.year * 12 + current.month;
};

const pad = (n: number) => String(n).padStart(2, "0");

export const monthLabel = ({ year, month }: Month) => `${String(year)}-${pad(month)}`;

// The month's first and last Cairo days, as YYYY-MM-DD (the analytics range).
export const monthDays = ({ year, month }: Month) => {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: `${monthLabel({ year, month })}-01`,
    to: `${monthLabel({ year, month })}-${pad(last)}`,
  };
};

// Where a month's workbook is stored. One key per month, so regenerating replaces it.
export const reportKey = (month: Month) => `analytics/reports/${monthLabel(month)}.xlsx`;

// The instants a month starts and ends (exclusive), in Cairo.
export const monthBounds = (target: Month) => {
  const next =
    target.month === 12
      ? { year: target.year + 1, month: 1 }
      : { ...target, month: target.month + 1 };
  return {
    start: cairoDayStart(`${monthLabel(target)}-01`),
    end: cairoDayStart(`${monthLabel(next)}-01`),
  };
};
