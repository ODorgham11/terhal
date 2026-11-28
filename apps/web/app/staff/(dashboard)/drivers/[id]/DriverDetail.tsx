"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  IconArchive,
  IconCash,
  IconChevronRight,
  IconPencil,
  IconRestore,
} from "@tabler/icons-react";
import type { Driver, DriverTransaction } from "@terhal/contracts";
import { DirectionalIcon } from "@/components/DirectionalIcon";
import { RequireStaff } from "@/components/session/RequireSession";
import { ListPagination, useCursorList } from "@/components/staff/CursorList";
import { InfoList, InfoRow, SectionCard } from "@/components/staff/SectionCard";
import { SystemState } from "@/components/staff/SystemState";
import { DriverDrawer } from "@/components/staff/fleet/DriverDrawer";
import { useArchive } from "@/components/staff/fleet/useArchive";
import { RecordPaymentDialog } from "@/components/staff/fleet/RecordPaymentDialog";
import { KindBadge, Phone, useBalance, useCalendarDate } from "@/components/staff/fleet/format";
import { FleetTrips } from "@/components/staff/fleet/FleetTrips";
import { useTripDates } from "@/components/staff/trips/format";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { AutoHeight, FadeText, fade } from "@/components/ui/Motion";
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
import { call, isApiError, staffApi, useErrorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

export function DriverDetailPage({ id }: { id: string }) {
  return <RequireStaff permission="fleet">{() => <Detail id={id} />}</RequireStaff>;
}

function Detail({ id }: { id: string }) {
  const driver = useQuery({
    queryKey: ["staff", "driver", id],
    queryFn: () => call(staffApi.drivers[":id"].$get({ param: { id } })),
    retry: (count, error) => !(isApiError(error) && error.status === 404) && count < 1,
  });
  if (driver.isPending) return <DriverLoading />;
  if (driver.isError) {
    return isApiError(driver.error) && driver.error.status === 404 ? (
      <SystemState kind="notFound" />
    ) : (
      <SystemState kind="error" onRetry={() => void driver.refetch()} />
    );
  }
  return <Loaded driver={driver.data} />;
}

function Loaded({ driver }: { driver: Driver }) {
  const t = useTranslations("staff.fleet.driver");
  const nav = useTranslations("staff.nav");
  const common = useTranslations("staff.common");
  const kinds = useTranslations("staff.fleet.kinds");
  const archive = useArchive("drivers");
  const format = useFormatter();
  const [dialog, setDialog] = useState<"edit" | "payment" | null>(null);
  const name = `${driver.firstName} ${driver.lastName}`;
  const archived = driver.archivedAt !== null;

  return (
    <motion.div {...fade} className="flex flex-col gap-6">
      <nav aria-label={t("breadcrumb")} className="flex items-center gap-2 text-xs">
        <Link href="/drivers" className="text-primary hover:underline">
          {nav("drivers")}
        </Link>
        <DirectionalIcon icon={IconChevronRight} className="size-3.5 text-muted" />
        <span className="text-muted">{name}</span>
      </nav>

      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-foreground">{name}</h1>
            <KindBadge item={driver} />
            {archived && <Badge tone="neutral">{t("archived")}</Badge>}
          </div>
          <p className="text-sm text-muted">
            {t("subtitle", {
              kind: kinds(driver.office ? "office" : driver.isExternal ? "external" : "internal"),
              date: format.dateTime(new Date(driver.createdAt), {
                month: "short",
                year: "numeric",
              }),
            })}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void archive(driver.id, archived)}>
            {archived ? (
              <IconRestore aria-hidden className="size-5" stroke={1.75} />
            ) : (
              <IconArchive aria-hidden className="size-5" stroke={1.75} />
            )}
            {archived ? common("restore") : common("archive")}
          </Button>
          <Button variant="secondary" onClick={() => setDialog("edit")}>
            <IconPencil aria-hidden className="size-5" stroke={1.75} />
            {common("edit")}
          </Button>
          <Button onClick={() => setDialog("payment")}>
            <IconCash aria-hidden className="size-5" stroke={1.75} />
            {t("recordPayment")}
          </Button>
        </div>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <BalanceCard driver={driver} />
          <LedgerCard driver={driver} />
          <SectionCard title={t("upcoming")}>
            <FleetTrips filter={{ driverId: driver.id }} />
          </SectionCard>
        </div>
        <div className="flex flex-col gap-5">
          <ProfileCard driver={driver} />
          {driver.notes && (
            <SectionCard title={t("notes")}>
              <p className="text-sm whitespace-pre-line text-foreground">{driver.notes}</p>
            </SectionCard>
          )}
          <MonthCard driver={driver} />
        </div>
      </div>

      <DriverDrawer
        driver={driver}
        open={dialog === "edit"}
        onOpenChange={(open) => setDialog(open ? "edit" : null)}
      />
      <RecordPaymentDialog
        driver={driver}
        open={dialog === "payment"}
        onOpenChange={(open) => setDialog(open ? "payment" : null)}
      />
    </motion.div>
  );
}

// The page's own shape in gray: breadcrumb, header and both columns of cards.
function DriverLoading() {
  const t = useTranslations("common.ui");
  const card = (lines: number, key: number) => (
    <div
      key={key}
      className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-5 shadow-xs"
    >
      <div className="flex h-8 items-center">
        <Skeleton className="h-4.5 w-32" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: lines }, (_, line) => (
          <Skeleton key={line} className={line % 2 ? "h-4 w-2/3" : "h-4 w-full"} />
        ))}
      </div>
    </div>
  );
  return (
    <motion.div {...fade} role="status" className="flex flex-col gap-6">
      <span className="sr-only">{t("loading")}</span>
      <Skeleton className="h-3.5 w-36" />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-44" />
            <Skeleton className="h-5.5 w-20 rounded-full" />
          </div>
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-28 rounded-lg" />
          <Skeleton className="h-10 w-24 rounded-lg" />
          <Skeleton className="h-10 w-40 rounded-lg" />
        </div>
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">{[3, 5, 3].map(card)}</div>
        <div className="flex flex-col gap-5">{[5, 3].map(card)}</div>
      </div>
    </motion.div>
  );
}

function useSummary(id: string) {
  return useQuery({
    queryKey: ["staff", "driver", id, "summary"],
    queryFn: () => call(staffApi.drivers[":id"].summary.$get({ param: { id } })),
  });
}

function BalanceCard({ driver }: { driver: Driver }) {
  const t = useTranslations("staff.fleet.driver.balance");
  const { price } = useTripDates();
  const summary = useSummary(driver.id);
  const amount = Number(driver.amountOwed);
  const balance = useBalance()(driver.amountOwed);
  const totals = summary.data?.totals;

  return (
    <SectionCard title={t("title")}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted">
            {amount === 0
              ? t("settled")
              : amount > 0
                ? t("companyOwes", { name: driver.firstName })
                : t("driverOwes", { name: driver.firstName })}
          </span>
          <span className={cn("text-2xl leading-8 font-semibold tabular-nums", balance.tone)}>
            <FadeText value={price(Math.abs(amount).toFixed(2))} />
          </span>
          <span className="max-w-sm text-xs text-muted">
            {amount === 0 ? t("settledHint") : amount > 0 ? t("owedHint") : t("owesHint")}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["cashCollected", totals?.cashCollected],
              ["earned", totals?.earned],
              ["payments", totals && (Number(totals.paidOut) + Number(totals.handedIn)).toFixed(2)],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="flex flex-col gap-0.5 rounded-lg bg-surface-muted px-3 py-2">
              <span className="text-xs text-muted">{t(key)}</span>
              {value === undefined ? (
                <Skeleton className="my-0.75 h-3.5 w-16" />
              ) : (
                <span className="text-sm font-medium text-foreground tabular-nums">
                  <FadeText value={price(value)} />
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
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

function LedgerCard({ driver }: { driver: Driver }) {
  const t = useTranslations("staff.fleet.driver.ledger");
  const errorMessage = useErrorMessage();
  const ledger = useCursorList(["staff", "driver", driver.id, "ledger"], {}, (query) =>
    call(staffApi.drivers[":id"].transactions.$get({ param: { id: driver.id }, query })),
  );

  const stale = ledger.result.isPlaceholderData;

  return (
    <SectionCard title={t("title")}>
      <AutoHeight>
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
              <LedgerRowsLoading />
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
      <ListPagination list={ledger} />
      <p className="text-xs text-muted">{t("hint", { name: driver.firstName })}</p>
    </SectionCard>
  );
}

function LedgerRow({ entry }: { entry: DriverTransaction }) {
  const t = useTranslations("staff.fleet.driver.ledger");
  const { day, price } = useTripDates();
  const amount = Number(entry.amount);
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
      <TableCell
        className={cn(
          "text-end font-medium whitespace-nowrap tabular-nums",
          amount > 0 ? "text-success" : "text-danger",
        )}
      >
        <span dir="ltr">
          {amount > 0 ? "+ " : "− "}
          {price(Math.abs(amount).toFixed(2))}
        </span>
      </TableCell>
    </MotionTableRow>
  );
}

function LedgerRowsLoading() {
  const t = useTranslations("common.ui");
  return (
    <>
      {[0, 1, 2].map((row) => (
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

function ProfileCard({ driver }: { driver: Driver }) {
  const t = useTranslations("staff.fleet.driver.profile");
  const fields = useTranslations("common.fields");
  const date = useCalendarDate();
  return (
    <SectionCard title={t("title")}>
      <InfoList>
        <InfoRow label={fields("phone")}>
          <Phone phone={driver.phone} />
        </InfoRow>
        <InfoRow label={fields("licenseNumber")}>
          <span dir="ltr">{driver.licenseNumber ?? "—"}</span>
        </InfoRow>
        <InfoRow label={fields("licenseExpiresAt")}>
          {driver.licenseExpiresAt ? date(driver.licenseExpiresAt) : "—"}
        </InfoRow>
        <InfoRow label={fields("nationalId")}>
          <span dir="ltr">{driver.nationalId ?? "—"}</span>
        </InfoRow>
        <InfoRow label={fields("office")}>
          {driver.office ? (
            <Link href={`/offices/${driver.office.id}`} className="hover:underline">
              {driver.office.name}
            </Link>
          ) : (
            t("noOffice")
          )}
        </InfoRow>
      </InfoList>
    </SectionCard>
  );
}

function MonthCard({ driver }: { driver: Driver }) {
  const t = useTranslations("staff.fleet.driver.month");
  const format = useFormatter();
  const { price } = useTripDates();
  const month = useSummary(driver.id).data?.thisMonth;
  return (
    <SectionCard title={t("title")}>
      <InfoList>
        <InfoRow label={t("trips")}>
          {month ? <FadeText value={format.number(month.tripsCompleted)} /> : <Pending />}
        </InfoRow>
        <InfoRow label={t("kilometres")}>
          {month ? <FadeText value={format.number(month.kilometres)} /> : <Pending />}
        </InfoRow>
        <InfoRow label={t("fees")}>
          {month ? <FadeText value={price(month.fees)} /> : <Pending />}
        </InfoRow>
      </InfoList>
    </SectionCard>
  );
}

// A value still on its way: a line its size, not an ellipsis.
function Pending() {
  return <Skeleton className="my-0.75 inline-block h-3.5 w-12 align-middle" />;
}
