"use client";

import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { TripReport } from "@terhal/contracts";
import { useTripDates } from "@/components/staff/trips/format";

// The report as it was sent: read only, since a sent report can't change through the link.
export function ReportSummary({ report }: { report: TripReport }) {
  const t = useTranslations("report.summary");
  const types = useTranslations("staff.trips.detail.report.expenseTypes");
  const units = useTranslations("report.form");
  const format = useFormatter();
  const { dateTime, time, price } = useTripDates();
  const km = report.endMileage - report.startMileage;

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 shadow-xs">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">{t("title")}</h2>
        <span className="text-xs text-muted">
          {t("sentAt", { date: dateTime(report.submittedAt) })}
        </span>
      </div>
      <dl className="flex flex-col gap-3 text-sm">
        <Row label={t("car")}>
          <span className="block">
            {t("out", { time: dateTime(report.startedAt), place: report.vehiclePickup })}
          </span>
          <span className="block">
            {t("back", { time: dateTime(report.endedAt), place: report.vehicleDropoff })}
          </span>
        </Row>
        <Row label={t("passenger")}>
          {t("passengerTimes", { from: time(report.pickupAt), to: time(report.dropoffAt) })} ·{" "}
          {t("stops", { count: report.stops.length })}
        </Row>
        <Row label={t("distance")}>
          {format.number(km)} {units("km")}
          <span className="block text-xs text-muted tabular-nums" dir="ltr">
            {format.number(report.startMileage)} → {format.number(report.endMileage)}
          </span>
        </Row>
        <Row label={t("cash")}>{price(report.cashCollected)}</Row>
        <Row label={t("expenses")}>
          {report.expenses.length === 0
            ? t("noExpenses")
            : report.expenses.map((expense) => (
                <span key={expense.id} className="block">
                  {types(expense.type)} · {price(expense.amount)}
                </span>
              ))}
        </Row>
      </dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3 first:border-0 first:pt-0">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-end text-foreground tabular-nums">{children}</dd>
    </div>
  );
}
