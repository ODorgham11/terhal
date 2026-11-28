"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  IconBan,
  IconCalendar,
  IconCash,
  IconChartBar,
  IconFileSpreadsheet,
  IconReceipt,
  IconRoute,
  IconTag,
} from "@tabler/icons-react";
import type { Analytics } from "@terhal/contracts";
import { RequireStaff } from "@/components/session/RequireSession";
import { Segmented } from "@/components/staff/Segmented";
import { SectionCard } from "@/components/staff/SectionCard";
import { StatCard } from "@/components/staff/StatCard";
import { SystemState } from "@/components/staff/SystemState";
import { TrendChart } from "@/components/staff/analytics/TrendChart";
import {
  asDate,
  previousOf,
  rangeKeys,
  rangeOf,
  type Range,
  type RangeKey,
} from "@/components/staff/analytics/ranges";
import { useLocalName, useTripDates } from "@/components/staff/trips/format";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { FadeText, ease, fade } from "@/components/ui/Motion";
import { Skeleton } from "@/components/ui/Skeleton";
import { call, staffApi } from "@/lib/api";
import { cn } from "@/lib/cn";

type Grouping = Analytics["groupBy"];

export function AnalyticsPage() {
  return <RequireStaff permission="analytics">{() => <Dashboard />}</RequireStaff>;
}

const analyticsQuery = (range: Range, groupBy: Grouping) => ({
  queryKey: ["staff", "analytics", range, groupBy],
  queryFn: () => call(staffApi.analytics.$get({ query: { ...range, groupBy } })),
  placeholderData: keepPreviousData,
});

function Dashboard() {
  const t = useTranslations("staff.analytics");
  const format = useFormatter();
  const [key, setKey] = useState<RangeKey>("thisMonth");
  const [groupBy, setGroupBy] = useState<Grouping>("week");
  const range = rangeOf(key);
  const previous = previousOf(key, range);
  const current = useQuery(analyticsQuery(range, groupBy));
  // Only the totals are compared, so the earlier range is asked for by month: the fewest buckets.
  const before = useQuery(analyticsQuery(previous, "month"));

  const span = (value: Range) =>
    format.dateTimeRange(asDate(value.from), asDate(value.to), {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  const versus =
    key === "thisMonth" || key === "lastMonth"
      ? format.dateTime(asDate(previous.from), { month: "long", timeZone: "UTC" })
      : t(`previous.${key}`);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle", { range: span(range), previous: span(previous) })}
        actions={
          <>
            <Select
              aria-label={t("range")}
              value={key}
              onChange={(event) => setKey(event.target.value as RangeKey)}
              className="sm:w-40"
            >
              {rangeKeys.map((option) => (
                <option key={option} value={option}>
                  {t(`ranges.${option}`)}
                </option>
              ))}
            </Select>
            <Segmented
              label={t("groupBy")}
              value={groupBy}
              onChange={setGroupBy}
              options={(["day", "week", "month"] as const).map((value) => ({
                value,
                label: t(`groupings.${value}`),
              }))}
            />
            <Button asChild variant="secondary">
              <Link href="/analytics/reports">
                <IconFileSpreadsheet aria-hidden className="size-5" stroke={1.75} />
                {t("monthlyReports")}
              </Link>
            </Button>
          </>
        }
      />
      {current.isPending ? (
        <AnalyticsLoading />
      ) : current.isError ? (
        <SystemState kind="error" onRetry={() => void current.refetch()} />
      ) : (
        // The last range's figures stay up, dimmed, until the new ones arrive; then each number fades to its new value.
        <motion.div
          {...fade}
          aria-busy={current.isFetching || undefined}
          className={cn(
            "flex flex-col gap-6 transition-opacity",
            current.isPlaceholderData && "opacity-60",
          )}
        >
          <Figures data={current.data} before={before.data} versus={versus} />
        </motion.div>
      )}
    </>
  );
}

// A change against the earlier range as a stat card's note: green when it's going the right way, red when not.
const shift = (change: { text: string; good: boolean } | undefined) =>
  change
    ? { note: change.text, noteTone: change.good ? ("success" as const) : ("danger" as const) }
    : {};

function Figures({
  data,
  before,
  versus,
}: {
  data: Analytics;
  before?: Analytics;
  versus: string;
}) {
  const t = useTranslations("staff.analytics");
  const cars = useTranslations("staff.trips.car");
  const sources = useTranslations("staff.analytics.sources");
  const expenseTypes = useTranslations("staff.trips.detail.report.expenseTypes");
  const name = useLocalName();
  const format = useFormatter();
  const { price } = useTripDates();
  const arrow = useLocale() === "ar" ? "←" : "→";
  const { totals } = data;
  const revenue = Number(totals.revenue);

  // "+14% vs October", or nothing when there's nothing to compare with.
  const change = (now: number, then: number | undefined) => {
    if (then === undefined || then === 0) return undefined;
    const ratio = (now - then) / then;
    return {
      text: t("versus", {
        change: format.number(ratio, {
          style: "percent",
          signDisplay: "exceptZero",
          maximumFractionDigits: 0,
        }),
        versus,
      }),
      good: ratio >= 0,
    };
  };
  const rateChange = (() => {
    if (!before || before.totals.trips === 0) return undefined;
    const points = (totals.cancellationRate - before.totals.cancellationRate) * 100;
    return {
      text: t("versusPoints", {
        points: format.number(points, { signDisplay: "exceptZero", maximumFractionDigits: 1 }),
        versus,
      }),
      good: points <= 0,
    };
  })();

  return (
    <>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          icon={IconCash}
          label={t("kpis.revenue")}
          value={price(totals.revenue)}
          {...shift(change(revenue, before && Number(before.totals.revenue)))}
        />
        <StatCard
          icon={IconChartBar}
          label={t("kpis.margin")}
          value={price(totals.margin)}
          note={
            revenue > 0
              ? t("ofRevenue", {
                  share: format.number(Number(totals.margin) / revenue, { style: "percent" }),
                })
              : undefined
          }
        />
        <StatCard
          icon={IconRoute}
          label={t("kpis.trips")}
          value={format.number(totals.trips)}
          {...shift(change(totals.trips, before?.totals.trips))}
        />
        <StatCard
          icon={IconBan}
          label={t("kpis.cancellationRate")}
          value={format.number(totals.cancellationRate, {
            style: "percent",
            maximumFractionDigits: 1,
          })}
          {...shift(rateChange)}
        />
        <StatCard
          icon={IconCalendar}
          label={t("kpis.bookedValue")}
          value={price(totals.bookedValue)}
          note={t("includesUpcoming")}
        />
        <StatCard
          icon={IconTag}
          label={t("kpis.averageFare")}
          value={totals.averageFare ? price(totals.averageFare) : "—"}
        />
        <StatCard
          icon={IconReceipt}
          label={t("kpis.costs")}
          value={price(totals.expenses)}
          note={t("costsNote")}
        />
        <StatCard
          icon={IconCash}
          label={t("kpis.unpaid")}
          value={price(totals.unpaid.amount)}
          note={t("unpaidTrips", { count: totals.unpaid.trips })}
          noteTone={totals.unpaid.trips > 0 ? "warning" : "muted"}
        />
      </div>

      <SectionCard title={t(`trend.title.${data.groupBy}`)}>
        <TrendChart trend={data.trend} groupBy={data.groupBy} />
        {data.groupBy === "week" && <p className="text-xs text-muted">{t("trend.weeksNote")}</p>}
      </SectionCard>

      <div className="grid items-start gap-5 lg:grid-cols-3">
        <Breakdown
          title={t("byClass")}
          rows={data.byClass.map((row) => ({
            key: row.classId,
            label: name(row),
            value: row.trips,
          }))}
        />
        <Breakdown
          title={t("byCar")}
          rows={data.byCar.map((row) => ({ key: row.car, label: cars(row.car), value: row.trips }))}
        />
        <Breakdown
          title={t("bySource")}
          rows={data.bySource.map((row) => ({
            key: row.source,
            label: sources(row.source),
            value: row.trips,
          }))}
        />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <SectionCard title={t("topRoutes.title")}>
          {data.topRoutes.length === 0 ? (
            <p className="text-sm text-muted">{t("noData")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted">
                  <th className="pb-2 text-start font-normal">{t("topRoutes.route")}</th>
                  <th className="pb-2 text-end font-normal">{t("topRoutes.trips")}</th>
                  <th className="pb-2 text-end font-normal">{t("topRoutes.revenue")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.topRoutes.map((route) => (
                  <tr key={`${route.from.id}-${route.to.id}`}>
                    <td className="py-2.5">
                      {name(route.from)} {arrow} {name(route.to)}
                    </td>
                    <td className="py-2.5 text-end tabular-nums">{route.trips}</td>
                    <td className="py-2.5 text-end whitespace-nowrap tabular-nums">
                      {price(route.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
        <div className="flex flex-col gap-5">
          <SectionCard title={t("balances.title")}>
            <BalanceTotals balances={data.driverBalances} />
          </SectionCard>
          <SectionCard title={t("costsByType")}>
            <ul className="flex flex-col divide-y divide-border text-sm">
              {data.costs.byType.map((cost) => (
                <li key={cost.type} className="flex justify-between gap-3 py-2">
                  <span>{expenseTypes(cost.type)}</span>
                  <span className="tabular-nums">{price(cost.amount)}</span>
                </li>
              ))}
              <li className="flex justify-between gap-3 py-2 font-medium">
                <span>{t("total")}</span>
                <span className="tabular-nums">{price(data.costs.total)}</span>
              </li>
            </ul>
          </SectionCard>
        </div>
      </div>
    </>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: string; value: number }[];
}) {
  const t = useTranslations("staff.analytics");
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <SectionCard title={title}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t("noData")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <motion.li key={row.key} layout {...fade} className="flex flex-col gap-1.5">
              <span className="flex justify-between gap-3 text-sm">
                <span>{row.label}</span>
                <span className="tabular-nums">
                  <FadeText value={row.value} />
                </span>
              </span>
              <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                <motion.span
                  className="block h-full rounded-full bg-primary"
                  initial={false}
                  animate={{ width: `${String((row.value / max) * 100)}%` }}
                  transition={ease}
                />
              </span>
            </motion.li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function BalanceTotals({ balances }: { balances: Analytics["driverBalances"] }) {
  const t = useTranslations("staff.analytics.balances");
  const { price } = useTripDates();
  const net = Number(balances.heldByDrivers) - Number(balances.owedToDrivers);
  return (
    <ul className="flex flex-col divide-y divide-border text-sm">
      <li className="flex justify-between gap-3 py-2">
        <span>{t("held")}</span>
        <span className="text-danger tabular-nums">{price(balances.heldByDrivers)}</span>
      </li>
      <li className="flex justify-between gap-3 py-2">
        <span>{t("owed")}</span>
        <span className="text-success tabular-nums">{price(balances.owedToDrivers)}</span>
      </li>
      <li className="flex justify-between gap-3 py-2 font-medium">
        <span>{t("net", { count: balances.drivers })}</span>
        <span
          className={cn(
            "tabular-nums",
            net > 0 ? "text-danger" : net < 0 ? "text-success" : "text-muted",
          )}
        >
          {net === 0
            ? t("settled")
            : net > 0
              ? t("driversOwe", { amount: price(net.toFixed(2)) })
              : t("weOwe", { amount: price((-net).toFixed(2)) })}
        </span>
      </li>
      <li className="pt-2">
        <Link href="/drivers" className="text-xs text-primary hover:underline">
          {t("seeDrivers")}
        </Link>
      </li>
    </ul>
  );
}

// The page's own shape in gray: the eight figures, the trend and the breakdowns.
function AnalyticsLoading() {
  const t = useTranslations("common.ui");
  const card = (children: ReactNode, key?: number) => (
    <div
      key={key}
      className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-5 shadow-xs"
    >
      <div className="flex h-8 items-center">
        <Skeleton className="h-4.5 w-36" />
      </div>
      {children}
    </div>
  );
  return (
    <motion.div {...fade} role="status" className="flex flex-col gap-6">
      <span className="sr-only">{t("loading")}</span>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div
            key={index}
            aria-hidden
            className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5"
          >
            <div className="flex items-center gap-2">
              <Skeleton className="size-7.5 rounded-lg" />
              <Skeleton className="h-3.5 w-24" />
            </div>
            <Skeleton className="my-1 h-6.5 w-28" />
            <Skeleton className="h-3 w-32 max-w-full" />
          </div>
        ))}
      </div>
      {card(<Skeleton className="h-78 w-full rounded-lg" />)}
      <div className="grid items-start gap-5 lg:grid-cols-3">
        {[0, 1, 2].map((index) =>
          card(
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex flex-col gap-1.5">
                  <div className="flex justify-between">
                    <Skeleton className={row % 2 ? "h-3.5 w-20" : "h-3.5 w-28"} />
                    <Skeleton className="h-3.5 w-6" />
                  </div>
                  <Skeleton className="h-1.5 w-full rounded-full" />
                </div>
              ))}
            </div>,
            index,
          ),
        )}
      </div>
    </motion.div>
  );
}
