import type { Prisma } from "../../../../generated/prisma/client";
import { appendTripLedger, tripLedgerBalances } from "../../fleet/index";
import { ledgerLines, reversalOf } from "../domain/report";
import type { TripActor } from "./events";

// The driver ledger's side of completing and reopening a trip (D8 a), run from the hooks inside the status change's
// transaction. The ledger is append-only, so reopening writes compensating entries instead of removing any.

type Tx = Prisma.TransactionClient;

const staffOf = (actor: TripActor) => ("staffId" in actor ? actor.staffId : null);

// Completed: the trip's driver is owed their fee (external drivers) and the expenses they paid, less the cash they
// collected, all taken from the report. A trip without a driver, or an office trip completed without a report (D9 a),
// writes nothing.
export const recordCompletion = async (
  tx: Tx,
  trip: { id: string; driverId: string | null },
  actor: TripActor,
) => {
  if (!trip.driverId) return;
  const row = await tx.trip.findUniqueOrThrow({
    where: { id: trip.id },
    select: {
      driver: { select: { isExternal: true } },
      report: {
        select: { cashCollected: true, expenses: { select: { type: true, amount: true } } },
      },
    },
  });
  if (!row.report || !row.driver) return;

  const lines = ledgerLines(
    {
      cashCollected: row.report.cashCollected.toFixed(2),
      expenses: row.report.expenses.map((expense) => ({
        type: expense.type,
        amount: expense.amount.toFixed(2),
      })),
    },
    row.driver.isExternal,
  );
  await appendTripLedger(tx, {
    driverId: trip.driverId,
    tripId: trip.id,
    staffId: staffOf(actor),
    entries: lines,
  });
};

// Reopened: whatever the trip still has on any driver's balance is cancelled by one adjustment per driver, so
// completing it again counts its (possibly corrected) report once.
export const reverseCompletion = async (tx: Tx, trip: { id: string }, actor: TripActor) => {
  for (const balance of await tripLedgerBalances(tx, trip.id)) {
    const amount = reversalOf(balance.amount);
    if (!amount) continue;
    await appendTripLedger(tx, {
      driverId: balance.driverId,
      tripId: trip.id,
      staffId: staffOf(actor),
      entries: [{ type: "ADJUSTMENT", amount, note: "The trip was reopened: its entries are reversed." }],
    });
  }
};
