import {
  auditActions,
  type DriverTransaction,
  type ListDriverTransactions,
  type RecordDriverTransaction,
} from "@terhal/contracts";
import type { Prisma } from "../../../../generated/prisma/client";
import { prisma } from "../../../platform/db/prisma";
import { recordAudit } from "../../audit/index";
import { lockRow, notFound, pageArgs, toPage, type StaffActor } from "./shared";

// The driver's ledger (docs/decisions.md, "The driver ledger"). Rows are append-only and Driver.amountOwed is their
// running total, both kept by the database (the fleet migration's triggers): the app only ever inserts.

const transactionSelect = {
  id: true,
  type: true,
  amount: true,
  trip: { select: { id: true, code: true } },
  staff: { select: { id: true, firstName: true, lastName: true } },
  note: true,
  createdAt: true,
} as const satisfies Prisma.DriverTransactionSelect;

type TransactionRow = Prisma.DriverTransactionGetPayload<{ select: typeof transactionSelect }>;

const toTransaction = (row: TransactionRow): DriverTransaction => ({
  ...row,
  amount: row.amount.toFixed(2),
  createdAt: row.createdAt.toISOString(),
});

// Newest first.
export const listDriverTransactions = async (
  driverId: string,
  { limit, cursor }: ListDriverTransactions,
) => {
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { id: true } });
  if (!driver) throw notFound("driver");

  const rows = await prisma.driverTransaction.findMany({
    where: { driverId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...pageArgs(limit, cursor),
    select: transactionSelect,
  });
  return toPage(rows, limit, toTransaction);
};

// A payout lowers what the company owes the driver by what was paid; an adjustment moves it by its signed amount.
// Archived drivers can still be paid what they're owed.
export const recordDriverTransaction = async (
  driverId: string,
  input: RecordDriverTransaction,
  actor: StaffActor,
) =>
  prisma.$transaction(async (tx) => {
    if (!(await lockRow(tx, "Driver", driverId))) throw notFound("driver");

    const amount = input.type === "PAYOUT" ? `-${input.amount}` : input.amount;
    const transaction = await tx.driverTransaction.create({
      data: {
        driverId,
        type: input.type,
        amount,
        staffId: actor.staffId,
        note: input.note ?? null,
      },
      select: transactionSelect,
    });
    const { amountOwed } = await tx.driver.findUniqueOrThrow({
      where: { id: driverId },
      select: { amountOwed: true },
    });

    await recordAudit(
      {
        staffId: actor.staffId,
        ipAddress: actor.ipAddress,
        action: auditActions.DRIVER_TRANSACTION_RECORDED,
        entityType: "Driver",
        entityId: driverId,
        after: {
          transactionId: transaction.id,
          type: input.type,
          amount: transaction.amount.toFixed(2),
          note: transaction.note,
          amountOwed: amountOwed.toFixed(2),
        },
      },
      tx,
    );

    return { transaction: toTransaction(transaction), amountOwed: amountOwed.toFixed(2) };
  });

// --- Entries a trip writes (the trips module, when a trip is completed or reopened) ---

export interface TripLedgerEntry {
  type: "TRIP_FEE" | "EXPENSE_REIMBURSEMENT" | "CASH_COLLECTED" | "ADJUSTMENT";
  // Signed, two decimals (DriverTransaction_sign holds each type to its direction).
  amount: string;
  note?: string;
}

// Appends a trip's entries to its driver's ledger, in the caller's transaction; the database keeps amountOwed.
export const appendTripLedger = async (
  tx: Prisma.TransactionClient,
  {
    driverId,
    tripId,
    staffId,
    entries,
  }: { driverId: string; tripId: string; staffId: string | null; entries: TripLedgerEntry[] },
) => {
  if (entries.length === 0) return;
  await tx.driverTransaction.createMany({
    data: entries.map((entry) => ({
      driverId,
      tripId,
      staffId,
      type: entry.type,
      amount: entry.amount,
      note: entry.note ?? null,
    })),
  });
};

// What a trip has added to each driver's balance so far, net of any reversals. Only trips write entries that name a
// trip (staff payouts and adjustments never do), so this is exactly what the trip's completions left standing.
export const tripLedgerBalances = async (tx: Prisma.TransactionClient, tripId: string) => {
  const rows = await tx.driverTransaction.groupBy({
    by: ["driverId"],
    where: { tripId },
    orderBy: { driverId: "asc" },
    _sum: { amount: true },
  });
  return rows.map((row) => ({
    driverId: row.driverId,
    amount: row._sum.amount?.toFixed(2) ?? "0.00",
  }));
};
