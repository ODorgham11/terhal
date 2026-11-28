// Analytics ranges are Cairo calendar days, YYYY-MM-DD, both ends included.

export type RangeKey = "thisMonth" | "lastMonth" | "last30" | "thisYear";
export const rangeKeys: RangeKey[] = ["thisMonth", "lastMonth", "last30", "thisYear"];

export type Range = { from: string; to: string };

const cairoDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" });

// Day arithmetic on calendar dates, at UTC noon so no offset moves the day.
const parse = (day: string) => new Date(`${day}T12:00:00Z`);
const print = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (day: string, days: number) => {
  const date = parse(day);
  date.setUTCDate(date.getUTCDate() + days);
  return print(date);
};
const monthStart = (day: string, monthsBack = 0) => {
  const date = parse(day);
  return print(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - monthsBack, 1, 12)));
};
const daysBetween = (from: string, to: string) =>
  Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);

export const today = () => cairoDay.format(new Date());

export function rangeOf(key: RangeKey, now = today()): Range {
  switch (key) {
    case "thisMonth":
      return { from: monthStart(now), to: now };
    case "lastMonth":
      return { from: monthStart(now, 1), to: addDays(monthStart(now), -1) };
    case "last30":
      return { from: addDays(now, -29), to: now };
    case "thisYear":
      return { from: `${now.slice(0, 4)}-01-01`, to: now };
  }
}

// What a range is compared with: the same days of the month before for month ranges (Nov 1–27 against Oct 1–27), the
// same days of the year before for the year, otherwise the days just before it.
export function previousOf(key: RangeKey, range: Range): Range {
  if (key === "thisMonth" || key === "lastMonth") {
    const from = monthStart(range.from, 1);
    const lastDay = addDays(monthStart(range.from), -1);
    const to = addDays(from, daysBetween(range.from, range.to));
    return { from, to: to > lastDay ? lastDay : to };
  }
  if (key === "thisYear") {
    const year = String(Number(range.from.slice(0, 4)) - 1);
    return { from: `${year}-01-01`, to: `${year}${range.to.slice(4)}` };
  }
  const length = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, -length), to: addDays(range.from, -1) };
}

export const asDate = parse;
