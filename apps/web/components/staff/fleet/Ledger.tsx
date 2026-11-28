"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import type { DriverTransaction } from "@terhal/contracts";
import { ListPagination, useCursorList } from "@/components/staff/CursorList";
import { useTripDates } from "@/components/staff/trips/format";
import { AutoHeight, fade } from "@/components/ui/Motion";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  MotionTableRow,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { call, staffApi, useErrorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

// A driver's ledger, newest first: every payment, fee and cash entry with what it did to their balance. With
// `paginated`, it pages through all of them; without, it shows the first `pageSize` only.
export function LedgerTable({
  driverId,
  pageSize,
  paginated = false,
}: {
  driverId: string;
  pageSize: number;
  paginated?: boolean;
}) {
  const t = useTranslations("staff.fleet.driver.ledger");
  const errorMessage = useErrorMessage();
  const ledger = useCursorList(
    ["staff", "driver", driverId, "ledger"],
    {},
    (query) => call(staffApi.drivers[":id"].transactions.$get({ param: { id: driverId }, query })),
    pageSize,
  );
  const stale = ledger.result.isPlaceholderData;

  return (
    <>
      {/* Phones, on the full ledger: one card per entry. */}
      {paginated && (
        <AutoHeight className="md:hidden">
          <ul
            aria-busy={ledger.result.isFetching || undefined}
            className={cn("flex flex-col gap-3 transition-opacity", stale && "opacity-60")}
          >
            {ledger.result.isPending ? (
              <LedgerCardsLoading />
            ) : ledger.result.isError ? (
              <motion.li {...fade} className="py-10 text-center text-sm text-danger">
                {errorMessage(ledger.result.error)}
              </motion.li>
            ) : ledger.rows.length === 0 ? (
              <motion.li {...fade} className="py-10 text-center text-base font-semibold">
                {t("empty")}
              </motion.li>
            ) : (
              ledger.rows.map((entry) => <LedgerCard key={entry.id} entry={entry} />)
            )}
          </ul>
        </AutoHeight>
      )}
      <AutoHeight className={paginated ? "hidden md:block" : undefined}>
        <Table
          aria-busy={ledger.result.isFetching || undefined}
          className={cn("transition-opacity", stale && "opacity-60")}
        >
          <TableHeader>
            <TableRow>
              <TableHead>{t("date")}</TableHead>
              <TableHead>{t("entry")}</TableHead>
              <TableHead>{t("trip")}</TableHead>
              <TableHead>{t("by")}</TableHead>
              <TableHead className="text-end">{t("amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ledger.result.isPending ? (
              <LedgerRowsLoading rows={paginated ? 8 : 3} />
            ) : ledger.result.isError ? (
              <TableEmpty columns={5} title={errorMessage(ledger.result.error)} />
            ) : ledger.rows.length === 0 ? (
              <TableEmpty columns={5} title={t("empty")} />
            ) : (
              ledger.rows.map((entry) => <LedgerRow key={entry.id} entry={entry} />)
            )}
          </TableBody>
        </Table>
      </AutoHeight>
      {paginated && <ListPagination list={ledger} />}
    </>
  );
}

const entryKeys = {
  TRIP_FEE: "tripFee",
  EXPENSE_REIMBURSEMENT: "expenses",
  CASH_COLLECTED: "cashCollected",
  PAYOUT: "payout",
  CASH_HANDED_IN: "handedIn",
  ADJUSTMENT: "adjustment",
} as const;

// The amount, signed and coloured: plus is more owed to the driver, minus less.
function Amount({ value }: { value: string }) {
  const { price } = useTripDates();
  const amount = Number(value);
  return (
    <span
      dir="ltr"
      className={cn(
        "font-medium whitespace-nowrap tabular-nums",
        amount > 0 ? "text-success" : "text-danger",
      )}
    >
      {amount > 0 ? "+ " : "− "}
      {price(Math.abs(amount).toFixed(2))}
    </span>
  );
}

function LedgerCard({ entry }: { entry: DriverTransaction }) {
  const t = useTranslations("staff.fleet.driver.ledger");
  const { day } = useTripDates();
  return (
    <motion.li
      {...fade}
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium text-foreground">
            {t(`entries.${entryKeys[entry.type]}`)}
          </span>
          {entry.note && <span className="text-xs text-muted">{entry.note}</span>}
        </div>
        <span className="text-sm">
          <Amount value={entry.amount} />
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted">
        <span>
          {day(entry.createdAt)} ·{" "}
          {entry.staff ? `${entry.staff.firstName} ${entry.staff.lastName}` : t("system")}
        </span>
        {entry.trip && (
          <Link
            href={`/trips/${entry.trip.id}`}
            dir="ltr"
            className="font-medium text-primary hover:underline"
          >
            {entry.trip.code}
          </Link>
        )}
      </div>
    </motion.li>
  );
}

function LedgerCardsLoading() {
  return (
    <>
      {[0, 1, 2].map((card) => (
        <motion.li
          key={card}
          {...fade}
          aria-hidden
          className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
        >
          <div className="flex justify-between">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3.5 w-20" />
          </div>
          <div className="flex justify-between border-t border-border pt-3">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-3 w-20" />
          </div>
        </motion.li>
      ))}
    </>
  );
}

function LedgerRow({ entry }: { entry: DriverTransaction }) {
  const t = useTranslations("staff.fleet.driver.ledger");
  const { day } = useTripDates();
  return (
    <MotionTableRow {...fade}>
      <TableCell className="whitespace-nowrap">{day(entry.createdAt)}</TableCell>
      <TableCell>
        <div className="flex flex-col">
          <span className="text-sm text-foreground">{t(`entries.${entryKeys[entry.type]}`)}</span>
          {entry.note && <span className="text-xs text-muted">{entry.note}</span>}
        </div>
      </TableCell>
      <TableCell>
        {entry.trip ? (
          <Link
            href={`/trips/${entry.trip.id}`}
            dir="ltr"
            className="text-sm font-medium text-primary hover:underline"
          >
            {entry.trip.code}
          </Link>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell className="text-muted">
        {entry.staff ? `${entry.staff.firstName} ${entry.staff.lastName}` : t("system")}
      </TableCell>
      <TableCell className="text-end">
        <Amount value={entry.amount} />
      </TableCell>
    </MotionTableRow>
  );
}

function LedgerRowsLoading({ rows }: { rows: number }) {
  const t = useTranslations("common.ui");
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <motion.tr
          key={row}
          {...fade}
          className="border-b border-border"
          aria-hidden={row > 0 || undefined}
        >
          <TableCell>
            {row === 0 && <span className="sr-only">{t("loading")}</span>}
            <Skeleton className="h-3.5 w-20" />
          </TableCell>
          <TableCell>
            <Skeleton className={cn("h-3.5", row % 2 ? "w-24" : "w-32")} />
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-22" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-24" />
          </TableCell>
          <TableCell>
            <Skeleton className="ms-auto h-3.5 w-20" />
          </TableCell>
        </motion.tr>
      ))}
    </>
  );
}
