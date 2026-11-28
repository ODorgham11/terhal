"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { Analytics } from "@terhal/contracts";
import { asDate } from "./ranges";

type Props = { trend: Analytics["trend"]; groupBy: Analytics["groupBy"] };

// A rounded ceiling for the axis: 1, 2 or 5 times a power of ten.
const niceMax = (value: number) => {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((multiple) => multiple * power >= value) ?? 10;
  return step * power;
};

// Revenue and costs side by side for each day, week or month in the range.
export function TrendChart({ trend, groupBy }: Props) {
  const t = useTranslations("staff.analytics.trend");
  const format = useFormatter();
  const max = niceMax(
    Math.max(...trend.flatMap((point) => [Number(point.revenue), Number(point.expenses)]), 0),
  );
  const ticks = [max, max / 2, 0];
  const compact = (value: number) =>
    format.number(value, { notation: "compact", maximumFractionDigits: 1 });
  const money = (value: string) =>
    `EGP ${format.number(Number(value), { maximumFractionDigits: 0 })}`;
  const label = (period: string) =>
    format.dateTime(
      asDate(period),
      groupBy === "month"
        ? { month: "short", year: "2-digit", timeZone: "UTC" }
        : { month: "short", day: "numeric", timeZone: "UTC" },
    );
  // Many buckets: label every few so they don't collide.
  const every = Math.ceil(trend.length / 12);

  return (
    <figure className="flex flex-col gap-3">
      <div className="flex gap-3">
        <div
          className="flex h-56 flex-col justify-between pb-6 text-xs text-muted tabular-nums"
          aria-hidden
        >
          {ticks.map((tick) => (
            <span key={tick}>{compact(tick)}</span>
          ))}
        </div>
        <div className="relative flex h-56 min-w-0 flex-1 items-end gap-1">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 bottom-6 flex flex-col justify-between"
          >
            {ticks.map((tick) => (
              <span key={tick} className="border-t border-dashed border-border" />
            ))}
          </div>
          {trend.map((point, index) => (
            <div key={point.period} className="flex h-full min-w-0 flex-1 flex-col items-center">
              <div
                className="flex w-full flex-1 items-end justify-center gap-0.5"
                title={`${label(point.period)}: ${t("revenue")} ${money(point.revenue)} · ${t("costs")} ${money(point.expenses)}`}
              >
                <span
                  className="w-full max-w-7 rounded-t-sm bg-primary transition-[height] duration-300 ease-out"
                  style={{ height: `${String((Number(point.revenue) / max) * 100)}%` }}
                />
                <span
                  className="w-full max-w-7 rounded-t-sm bg-accent transition-[height] duration-300 ease-out"
                  style={{ height: `${String((Number(point.expenses) / max) * 100)}%` }}
                />
              </div>
              <span className="h-6 truncate pt-1.5 text-xs text-muted">
                {index % every === 0 ? label(point.period) : ""}
              </span>
            </div>
          ))}
        </div>
      </div>
      {/* The bars as a table, for screen readers. */}
      <table className="sr-only">
        <caption>{t("caption")}</caption>
        <thead>
          <tr>
            <th>{t("period")}</th>
            <th>{t("revenue")}</th>
            <th>{t("costs")}</th>
          </tr>
        </thead>
        <tbody>
          {trend.map((point) => (
            <tr key={point.period}>
              <td>{label(point.period)}</td>
              <td>{money(point.revenue)}</td>
              <td>{money(point.expenses)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
