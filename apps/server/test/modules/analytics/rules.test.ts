import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, csvLine } from "../../../src/modules/analytics/domain/csv";
import {
  averageMoney,
  formatPiastres,
  rate,
  subtractMoney,
  toPiastres,
} from "../../../src/modules/analytics/domain/money";
import {
  cairoDay,
  cairoDayStart,
  cairoMonthOf,
  cairoWallClock,
  isMonthOver,
  monthBounds,
  monthDays,
  previousMonth,
  reportKey,
} from "../../../src/modules/analytics/domain/months";

describe("money", () => {
  it("adds and subtracts in piastres, never in floats", () => {
    expect(toPiastres("0.10") + toPiastres("0.20")).toBe(30n);
    expect(formatPiastres(30n)).toBe("0.30");
    expect(subtractMoney("1500.00", "400.5")).toBe("1099.50");
    expect(subtractMoney("100.00", "250.25")).toBe("-150.25");
    expect(formatPiastres(-5n)).toBe("-0.05");
  });

  it("averages to the piastre, rounding half up, and has no average of nothing", () => {
    expect(averageMoney("1500.00", 2)).toBe("750.00");
    expect(averageMoney("10.00", 3)).toBe("3.33");
    expect(averageMoney("0.05", 2)).toBe("0.03");
    expect(averageMoney("0.00", 0)).toBeNull();
  });

  it("gives a rate to four decimals, 0 out of nothing", () => {
    expect(rate(1, 4)).toBe(0.25);
    expect(rate(1, 3)).toBe(0.3333);
    expect(rate(0, 0)).toBe(0);
  });
});

describe("Cairo's months", () => {
  it("reads the Cairo day and month across midnight and the summer clock", () => {
    // Summer time (UTC+3) until the last Thursday of October 2026, then UTC+2.
    expect(cairoDay(new Date("2026-07-31T20:59:00Z"))).toBe("2026-07-31");
    expect(cairoDay(new Date("2026-07-31T21:00:00Z"))).toBe("2026-08-01");
    expect(cairoMonthOf(new Date("2026-10-31T22:30:00Z"))).toEqual({ year: 2026, month: 11 });
    expect(cairoWallClock(new Date("2026-10-31T22:30:00Z"))).toBe("2026-11-01 00:30");
  });

  it("finds the instant a Cairo day starts, in winter and in summer", () => {
    expect(cairoDayStart("2026-11-01").toISOString()).toBe("2026-10-31T22:00:00.000Z");
    expect(cairoDayStart("2026-08-01").toISOString()).toBe("2026-07-31T21:00:00.000Z");
    expect(cairoDayStart("2026-01-01").toISOString()).toBe("2025-12-31T22:00:00.000Z");
  });

  it("bounds a month by Cairo midnights", () => {
    expect(monthBounds({ year: 2026, month: 12 })).toEqual({
      start: new Date("2026-11-30T22:00:00Z"),
      end: new Date("2026-12-31T22:00:00Z"),
    });
    expect(monthDays({ year: 2028, month: 2 })).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("knows the month before, and when a month is over in Cairo", () => {
    expect(previousMonth({ year: 2027, month: 1 })).toEqual({ year: 2026, month: 12 });
    expect(previousMonth({ year: 2026, month: 11 })).toEqual({ year: 2026, month: 10 });
    const october = { year: 2026, month: 10 };
    // 23:30 on 31 October in Cairo, then 00:30 on 1 November.
    expect(isMonthOver(october, new Date("2026-10-31T21:30:00Z"))).toBe(false);
    expect(isMonthOver(october, new Date("2026-10-31T22:30:00Z"))).toBe(true);
    expect(isMonthOver({ year: 2026, month: 11 }, new Date("2026-10-31T22:30:00Z"))).toBe(false);
  });

  it("keeps one storage key per month", () => {
    expect(reportKey({ year: 2026, month: 3 })).toBe("analytics/reports/2026-03.xlsx");
  });
});

describe("CSV", () => {
  it("quotes what needs quoting and neutralizes formulas", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", twice')).toBe('"say ""hi"", twice"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+201000000000")).toBe("'+201000000000");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("\tx")).toBe("'\tx");
    expect(csvCell('=1,"2"')).toBe(`"'=1,""2"""`);
  });

  it("leaves numbers, negative amounts, booleans and blanks as they are", () => {
    expect(csvCell("-150.25")).toBe("-150.25");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("ends lines with CRLF and starts files with a byte order mark", () => {
    expect(csvLine(["a", "ب", null])).toBe("a,ب,\r\n");
    expect(CSV_BOM).toBe("﻿");
  });
});
