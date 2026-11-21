import type { Prisma } from "../../../../generated/prisma/client";
import type { RecordedTripEvent, TripActor } from "./events";
import { issueReportLink } from "./report-link";

// Where the features built on trips plug in. Each runs inside the transaction of the change that triggered it, so its
// writes (a notification row, a ledger entry) are saved with the change or not at all. Keep them fast: anything slow
// (sending an email) belongs in a job enqueued from here, with a deterministic id (docs/architecture.md, Jobs).

type Tx = Prisma.TransactionClient;
interface HookTrip {
  id: string;
  driverId: string | null;
}

// Every trip event, right after it's written: the single hook for notifications (N1). The event names its action, its
// actor and its data (statuses moved between, reason, changed fields), and the trip's id.
export const afterTripEvent: (tx: Tx, event: RecordedTripEvent) => Promise<void> = () =>
  Promise.resolve();

// A trip moved to COMPLETED (T4 a): the driver ledger's entries for it (D8 a: the trip fee for external drivers,
// reimbursed expenses, cash collected) are written here.
export const onTripCompleted: (tx: Tx, trip: HookTrip, actor: TripActor) => Promise<void> = () =>
  Promise.resolve();

// A completed trip was reopened (T8 a, back to AWAITING_REPORT): whatever onTripCompleted wrote is reversed here, so
// completing it again doesn't count twice.
export const onTripReopened: (tx: Tx, trip: HookTrip, actor: TripActor) => Promise<void> = () =>
  Promise.resolve();

// The trip's driver changed (A1, D1 b, D2 a). The old report link is already revoked by then; a new one is issued here
// for the new driver, if there is one.
export const onDriverChanged: (tx: Tx, trip: HookTrip) => Promise<void> = issueReportLink;
