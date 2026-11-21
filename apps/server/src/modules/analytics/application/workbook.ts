import type { Analytics } from "@terhal/contracts";
import ExcelJS from "exceljs";
import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import { prisma } from "../../../platform/db/prisma";
import type { CsvValue } from "../domain/csv";
import { cairoWallClock, monthBounds, monthLabel, type Month } from "../domain/months";
import { TRIP_CSV_HEADER, after, fetchTrips, pages, tripValues } from "./exports";

// The monthly workbook (Y3 a): a summary sheet with the month's figures, then its trips, expenses, driver ledger
// entries and office fees. Written with exceljs's streaming writer, a page of rows at a time, so a busy month never
// holds every row as cells; the finished file is returned as bytes for storage. Cells hold values, never formulas, so
// text from users can't run as one.

type Cell = string | number | boolean | null;

const MONEY_FORMAT = "#,##0.00";
const amount = /^-?\d+\.\d{2}$/;

// Amounts become numbers, so a spreadsheet can add them up; everything else stays as it is.
const cell = (value: CsvValue): Cell => {
  if (value === undefined) return null;
  return typeof value === "string" && amount.test(value) ? Number(value) : value;
};

const money = (value: string) => Number(value);

interface Sheet {
  addRow(values: Cell[]): { commit(): void };
  commit(): void;
}

const addSheet = (
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  name: string,
  header: readonly string[],
) => {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  const head = sheet.addRow([...header]);
  head.font = { bold: true };
  head.commit();
  return sheet as unknown as Sheet;
};

const summarySheet = (
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  target: Month,
  figures: Analytics,
  generatedAt: Date,
) => {
  const sheet = workbook.addWorksheet("Summary");
  sheet.columns = [{ width: 34 }, { width: 18 }, { width: 14 }, { width: 18 }];
  const row = (values: Cell[], { bold = false, moneyAt = [] as number[] } = {}) => {
    const added = sheet.addRow(values);
    if (bold) added.font = { bold: true };
    for (const column of moneyAt) added.getCell(column).numFmt = MONEY_FORMAT;
    added.commit();
  };
  const { totals } = figures;

  row([`Terhal report, ${monthLabel(target)}`], { bold: true });
  row(["Generated (Cairo time)", cairoWallClock(generatedAt)]);
  row(["Trips count by pickup, in Cairo days."]);
  row([]);
  row(["Trips", totals.trips]);
  row(["Completed", totals.completed]);
  row(["Cancelled", totals.cancelled]);
  row(["Cancellation rate", totals.cancellationRate]);
  row(["Revenue (completed trips)", money(totals.revenue)], { moneyAt: [2] });
  row(["Booked value (not cancelled)", money(totals.bookedValue)], { moneyAt: [2] });
  row(["Average fare", totals.averageFare === null ? null : money(totals.averageFare)], {
    moneyAt: [2],
  });
  row(["Expenses (completed trips)", money(totals.expenses)], { moneyAt: [2] });
  row(["Office fees", money(totals.officeFees)], { moneyAt: [2] });
  row(["Margin", money(totals.margin)], { moneyAt: [2], bold: true });
  row(["Completed, not paid", totals.unpaid.trips]);
  row(["Completed, not paid (amount)", money(totals.unpaid.amount)], { moneyAt: [2] });

  row([]);
  row(["By status", "Trips"], { bold: true });
  for (const [status, count] of Object.entries(totals.byStatus)) row([status, count]);

  row([]);
  row(["Expenses by type", "Amount"], { bold: true });
  for (const { type, amount: value } of figures.costs.byType) {
    row([type, money(value)], { moneyAt: [2] });
  }

  const performance = (
    title: string,
    rows: { label: string; trips: number; completed: number; revenue: string }[],
  ) => {
    row([]);
    row([title, "Trips", "Completed", "Revenue"], { bold: true });
    for (const entry of rows) {
      row([entry.label, entry.trips, entry.completed, money(entry.revenue)], { moneyAt: [4] });
    }
  };
  performance(
    "By source",
    figures.bySource.map((entry) => ({ label: entry.source, ...entry })),
  );
  performance(
    "By class",
    figures.byClass.map((entry) => ({ label: `${entry.nameEn} / ${entry.nameAr}`, ...entry })),
  );
  performance(
    "By car body",
    figures.byCar.map((entry) => ({ label: entry.car, ...entry })),
  );
  performance(
    "Top routes (governorates)",
    figures.topRoutes.map((entry) => ({
      label: `${entry.from.nameEn} → ${entry.to.nameEn}`,
      ...entry,
    })),
  );
  performance("In house or office", [
    { label: "In house", ...figures.fleet.inHouse },
    { label: "Office", ...figures.fleet.office },
  ]);

  row([]);
  row(["Driver balances (when generated)", "Amount"], { bold: true });
  row(["Owed to drivers", money(figures.driverBalances.owedToDrivers)], { moneyAt: [2] });
  row(["Held by drivers", money(figures.driverBalances.heldByDrivers)], { moneyAt: [2] });
  sheet.commit();
};

const name = (who: { firstName: string; lastName: string } | null) =>
  who ? `${who.firstName} ${who.lastName}` : null;

export const buildWorkbook = async (target: Month, figures: Analytics, generatedAt: Date) => {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => chunks.push(chunk));
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useStyles: true });
  workbook.creator = "Terhal";
  workbook.created = generatedAt;

  summarySheet(workbook, target, figures, generatedAt);

  const { start, end } = monthBounds(target);
  const inMonth = { pickupDate: { gte: start, lt: end } };

  const trips = addSheet(workbook, "Trips", TRIP_CSV_HEADER);
  for await (const rows of pages(fetchTrips(inMonth))) {
    for (const trip of rows) trips.addRow(tripValues(trip).map(cell)).commit();
  }
  trips.commit();

  const expenseSelect = {
    id: true,
    type: true,
    amount: true,
    notes: true,
    report: {
      select: {
        trip: {
          select: {
            code: true,
            status: true,
            pickupDate: true,
            driver: { select: { firstName: true, lastName: true } },
            office: { select: { name: true } },
          },
        },
      },
    },
  } as const;
  const fetchExpenses =
    (where: object) =>
    ({ take, cursor }: { take: number; cursor?: string }) =>
      prisma.tripExpense.findMany({
        where: { report: { trip: inMonth }, ...where },
        orderBy: { id: "asc" },
        take,
        ...after(cursor),
        select: expenseSelect,
      });

  const expenses = addSheet(workbook, "Expenses", [
    "tripCode",
    "tripStatus",
    "pickupCairo",
    "type",
    "amount",
    "notes",
    "driver",
    "office",
  ]);
  for await (const rows of pages(fetchExpenses({}))) {
    for (const { report, ...expense } of rows) {
      expenses
        .addRow([
          report.trip.code,
          report.trip.status,
          cairoWallClock(report.trip.pickupDate),
          expense.type,
          Number(expense.amount.toFixed(2)),
          expense.notes,
          name(report.trip.driver),
          report.trip.office?.name ?? null,
        ])
        .commit();
    }
  }
  expenses.commit();

  // Ledger entries made during the month, whichever trip they come from.
  const ledger = addSheet(workbook, "Driver transactions", [
    "createdCairo",
    "driver",
    "driverPhone",
    "type",
    "amount",
    "tripCode",
    "staff",
    "note",
  ]);
  for await (const rows of pages(({ take, cursor }) =>
    prisma.driverTransaction.findMany({
      where: { createdAt: { gte: start, lt: end } },
      orderBy: { id: "asc" },
      take,
      ...after(cursor),
      include: {
        driver: { select: { firstName: true, lastName: true, phone: true } },
        trip: { select: { code: true } },
        staff: { select: { firstName: true, lastName: true } },
      },
    }),
  )) {
    for (const entry of rows) {
      ledger
        .addRow([
          cairoWallClock(entry.createdAt),
          name(entry.driver),
          entry.driver.phone,
          entry.type,
          Number(entry.amount.toFixed(2)),
          entry.trip?.code ?? null,
          name(entry.staff),
          entry.note,
        ])
        .commit();
    }
  }
  ledger.commit();

  const offices = addSheet(workbook, "Office fees", [
    "office",
    "tripCode",
    "tripStatus",
    "pickupCairo",
    "amount",
    "notes",
  ]);
  for await (const rows of pages(fetchExpenses({ type: "OFFICE_FEE" }))) {
    for (const { report, ...expense } of rows) {
      offices
        .addRow([
          report.trip.office?.name ?? null,
          report.trip.code,
          report.trip.status,
          cairoWallClock(report.trip.pickupDate),
          Number(expense.amount.toFixed(2)),
          expense.notes,
        ])
        .commit();
    }
  }
  offices.commit();

  await workbook.commit();
  await finished(output);
  return new Uint8Array(Buffer.concat(chunks));
};
