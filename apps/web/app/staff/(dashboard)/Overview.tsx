"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  IconChevronRight,
  IconClockExclamation,
  IconFileText,
  IconPlus,
  IconRoute,
  IconSteeringWheel,
  IconTag,
} from "@tabler/icons-react";
import type { Staff, Trip } from "@terhal/contracts";
import { DirectionalIcon } from "@/components/DirectionalIcon";
import { RequireStaff } from "@/components/session/RequireSession";
import { visibleGroups } from "@/components/staff/nav";
import { overviewQuery } from "@/components/staff/queries";
import { StatCard } from "@/components/staff/StatCard";
import { TripStatusBadge } from "@/components/staff/trips/TripStatusBadge";
import { useRoute, useTripDates } from "@/components/staff/trips/format";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { call, staffApi } from "@/lib/api";
import { cairoHour, startOfCairoDay } from "@/lib/cairo";
import { cn } from "@/lib/cn";

type TripQuery = Parameters<typeof staffApi.trips.$get>[0]["query"];

const tripsQuery = (query: TripQuery) => ({
  queryKey: ["staff", "trips", query],
  queryFn: () => call(staffApi.trips.$get({ query })),
  refetchInterval: 60_000,
});

export function Overview() {
  return (
    <RequireStaff>
      {(staff) =>
        staff.permissions.includes("trips") ? (
          <TripsOverview staff={staff} />
        ) : (
          <ElsewhereHome staff={staff} />
        )
      }
    </RequireStaff>
  );
}

// The overview is about trips. Staff who can't see trips go to the first page they can use.
function ElsewhereHome({ staff }: { staff: Staff }) {
  const router = useRouter();
  const first = visibleGroups(staff.permissions)[0]?.items[0]?.href ?? "/account";
  useEffect(() => router.replace(first), [first, router]);
  return null;
}

function TripsOverview({ staff }: { staff: Staff }) {
  const t = useTranslations("staff.overview");
  const format = useFormatter();
  const counts = useQuery(overviewQuery).data;
  const hour = cairoHour();
  const greeting = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

  return (
    <>
      <PageHeader
        title={t(`greeting.${greeting}`, { name: staff.firstName })}
        description={t("subtitle", {
          date: format.dateTime(new Date(), {
            weekday: "long",
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
        })}
        actions={
          <Button asChild>
            <Link href="/trips/new">
              <IconPlus aria-hidden className="size-5" stroke={1.75} />
              {t("newTrip")}
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={IconRoute}
          label={t("kpi.today")}
          value={counts?.today ?? "–"}
          note={counts && t("kpi.tomorrow", { count: counts.tomorrow })}
        />
        <StatCard
          icon={IconSteeringWheel}
          label={t("kpi.unassigned")}
          value={counts?.unassigned ?? "–"}
          note={
            counts && counts.overdue > 0 ? t("kpi.overdue", { count: counts.overdue }) : undefined
          }
          noteTone="danger"
        />
        <StatCard
          icon={IconTag}
          label={t("kpi.priceRequests")}
          value={counts?.priceRequests ?? "–"}
        />
        <StatCard
          icon={IconFileText}
          label={t("kpi.awaitingReport")}
          value={counts?.awaitingReport ?? "–"}
          note={
            counts && counts.inProgress > 0
              ? t("kpi.inProgress", { count: counts.inProgress })
              : undefined
          }
        />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_23.75rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <NeedsAction />
          <TodaysPickups />
        </div>
        <OnTheRoad />
      </div>
    </>
  );
}

// What someone has to do something about, soonest pickup first.
type Reason = "price" | "confirm" | "assign" | "report";

const reasonOf = (trip: Trip): Reason | null => {
  if (trip.status === "AWAITING_REPORT") return "report";
  if (trip.status === "PENDING") return trip.priceState === "REQUESTED" ? "price" : "confirm";
  if (trip.status === "CONFIRMED" && !trip.driver && !trip.office) return "assign";
  return null;
};

const reasonTones: Record<Reason, string> = {
  price: "text-accent",
  confirm: "text-warning",
  assign: "text-warning",
  report: "text-info",
};

function NeedsAction() {
  const t = useTranslations("staff.overview.needsAction");
  const pending = useQuery(tripsQuery({ status: "PENDING", limit: "10" }));
  const unassigned = useQuery(tripsQuery({ unassigned: "true", limit: "10" }));
  const reports = useQuery(tripsQuery({ status: "AWAITING_REPORT", limit: "10" }));
  const loading = pending.isPending || unassigned.isPending || reports.isPending;

  const byId = new Map<string, Trip>();
  for (const trip of [
    ...(pending.data?.data ?? []),
    ...(unassigned.data?.data ?? []),
    ...(reports.data?.data ?? []),
  ])
    byId.set(trip.id, trip);
  const rows = [...byId.values()]
    .map((trip) => ({ trip, reason: reasonOf(trip) }))
    .filter((row): row is { trip: Trip; reason: Reason } => row.reason !== null)
    .sort((a, b) => a.trip.pickupDate.localeCompare(b.trip.pickupDate))
    .slice(0, 6);

  return (
    <Card className="p-5">
      <CardHeader
        title={t("title")}
        className="p-0 pb-3"
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/trips">
              {t("allTrips")}
              <DirectionalIcon icon={IconChevronRight} className="size-4" />
            </Link>
          </Button>
        }
      />
      {loading ? (
        <RowsLoading />
      ) : rows.length === 0 ? (
        <p className="border-t border-border py-6 text-center text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul>
          {rows.map(({ trip, reason }) => (
            <ActionRow key={trip.id} trip={trip} reason={reason} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ActionRow({ trip, reason }: { trip: Trip; reason: Reason }) {
  const t = useTranslations("staff.overview.needsAction");
  const route = useRoute();
  const dates = useTripDates();

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border py-3">
      <Link
        href={`/trips/${trip.id}`}
        className="w-25 shrink-0 text-sm font-medium text-primary hover:underline"
        dir="ltr"
      >
        {trip.code}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="truncate text-sm font-medium text-foreground">{route(trip)}</p>
        <p className="text-xs text-muted">{dates.dateTime(trip.pickupDate)}</p>
      </div>
      <TripStatusBadge status={trip.status} />
      <p className={cn("w-30 text-xs font-medium", reasonTones[reason])}>
        {t(`reasons.${reason}`)}
      </p>
      <Button asChild variant="secondary" size="sm">
        <Link href={`/trips/${trip.id}`}>{t(`actions.${reason}`)}</Link>
      </Button>
    </li>
  );
}

// Every trip picking up today in Cairo, cancelled ones left out.
function TodaysPickups() {
  const t = useTranslations("staff.overview.today");
  const route = useRoute();
  const dates = useTripDates();
  const today = useQuery(
    tripsQuery({
      from: startOfCairoDay().toISOString(),
      to: startOfCairoDay(new Date(), 1).toISOString(),
      limit: "100",
    }),
  );
  const trips = (today.data?.data ?? [])
    .filter((trip) => trip.status !== "CANCELLED")
    .sort((a, b) => a.pickupDate.localeCompare(b.pickupDate));

  return (
    <Card className="p-5">
      <CardHeader
        title={t("title")}
        className="p-0 pb-3"
        actions={
          today.data && (
            <span className="text-xs text-muted">{t("count", { count: trips.length })}</span>
          )
        }
      />
      {today.isPending ? (
        <RowsLoading />
      ) : trips.length === 0 ? (
        <p className="border-t border-border py-6 text-center text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul>
          {trips.map((trip) => {
            const who = trip.driver
              ? `${trip.driver.firstName} ${trip.driver.lastName}`
              : trip.office?.name;
            return (
              <li key={trip.id} className="flex items-center gap-4 border-t border-border py-3">
                <p className="w-17.5 shrink-0 text-sm font-medium text-foreground">
                  {dates.time(trip.pickupDate)}
                </p>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Link
                    href={`/trips/${trip.id}`}
                    className="truncate text-sm font-medium text-foreground hover:underline"
                  >
                    {route(trip)}
                  </Link>
                  <p className="text-xs text-muted" dir="ltr">
                    <span className="sr-only">{t("code")} </span>
                    {trip.code}
                  </p>
                </div>
                <p
                  className={cn(
                    "hidden w-35 truncate text-sm sm:block",
                    who ? "text-foreground" : "text-warning",
                  )}
                >
                  {who ?? t("unassigned")}
                </p>
                <TripStatusBadge status={trip.status} />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function OnTheRoad() {
  const t = useTranslations("staff.overview.onTheRoad");
  const route = useRoute();
  const dates = useTripDates();
  const trips = useQuery(tripsQuery({ status: "IN_PROGRESS", limit: "20" }));

  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="text-base font-semibold text-foreground">{t("title")}</h2>
      {trips.isPending ? (
        <RowsLoading />
      ) : trips.data?.data.length ? (
        <ul className="flex flex-col gap-3">
          {trips.data.data.map((trip) => (
            <li key={trip.id}>
              <Link href={`/trips/${trip.id}`} className="group flex items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <IconSteeringWheel aria-hidden className="size-4" stroke={1.75} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-foreground group-hover:underline">
                    {trip.driver
                      ? `${trip.driver.firstName} ${trip.driver.lastName}`
                      : (trip.office?.name ?? trip.code)}
                  </span>
                  <span className="truncate text-xs text-muted">
                    {t("detail", { route: route(trip), time: dates.time(trip.pickupDate) })}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted">
          <IconClockExclamation aria-hidden className="size-4" stroke={1.75} />
          {t("empty")}
        </p>
      )}
    </Card>
  );
}

function RowsLoading() {
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="h-10 w-full" />
      ))}
    </div>
  );
}
