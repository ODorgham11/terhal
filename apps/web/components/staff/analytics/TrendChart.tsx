"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import type { Analytics } from "@terhal/contracts";
import { Segmented } from "@/components/staff/Segmented";
import { ease } from "@/components/ui/Motion";
import { cn } from "@/lib/cn";
import { asDate } from "./ranges";

type Point = Analytics["trend"][number];
type Props = { trend: Analytics["trend"]; groupBy: Analytics["groupBy"] };
type Metric = "money" | "trips";

// Each view's two series, in a fixed order: the first is the darker maroon, the second the copper. They're the
// brand's two colours, lightened into the band charts read well in (checked for colour blindness).
const series = {
  money: [
    { key: "revenue", color: "bg-chart-1", value: (point: Point) => Number(point.revenue) },
    { key: "costs", color: "bg-chart-2", value: (point: Point) => Number(point.expenses) },
  ],
  trips: [
    { key: "completed", color: "bg-chart-1", value: (point: Point) => point.completed },
    { key: "cancelled", color: "bg-chart-2", value: (point: Point) => point.cancelled },
  ],
} as const;

// A round step for the axis, so the four gridlines land on readable numbers: 1, 2, 2.5 or 5 times a power of ten.
const niceStep = (value: number, whole: boolean) => {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = ([1, 2, 2.5, 5, 10].find((multiple) => multiple * power >= value) ?? 10) * power;
  return whole ? Math.max(1, Math.ceil(step)) : step;
};
const TICKS = 4;

// Revenue and costs side by side, or completed and cancelled trips stacked, for each day, week or month in the range.
// Hovering a period (or moving along with the arrow keys) shows all its figures.
export function TrendChart({ trend, groupBy }: Props) {
  const t = useTranslations("staff.analytics.trend");
  const format = useFormatter();
  const [metric, setMetric] = useState<Metric>("money");
  const [active, setActive] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);

  const lines = series[metric];
  const stacked = metric === "trips";
  const tallest = Math.max(
    0,
    ...trend.map((point) =>
      stacked
        ? lines[0].value(point) + lines[1].value(point)
        : Math.max(lines[0].value(point), lines[1].value(point)),
    ),
  );
  const step = niceStep(tallest / TICKS, stacked);
  const max = step * TICKS;
  const ticks = Array.from({ length: TICKS + 1 }, (_, index) => max - index * step);
  const empty = tallest === 0;

  const axis = (value: number) =>
    format.number(value, { notation: "compact", maximumFractionDigits: 1 });
  const money = (value: string | number) =>
    `EGP ${format.number(Number(value), { maximumFractionDigits: 0 })}`;
  const tick = (period: string) =>
    format.dateTime(
      asDate(period),
      groupBy === "month"
        ? { month: "short", year: "2-digit", timeZone: "UTC" }
        : { month: "short", day: "numeric", timeZone: "UTC" },
    );
  const title = (period: string) =>
    groupBy === "month"
      ? format.dateTime(asDate(period), { month: "long", year: "numeric", timeZone: "UTC" })
      : groupBy === "week"
        ? t("weekOf", {
            date: format.dateTime(asDate(period), {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            }),
          })
        : format.dateTime(asDate(period), {
            weekday: "short",
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          });

  // Many periods: label every few so they don't collide, and thin the space between bars.
  const every = Math.ceil(trend.length / 10);
  const gutter = trend.length > 60 ? "px-px" : trend.length > 20 ? "px-0.5" : "px-1.5";

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor(((event.clientX - box.left) / box.width) * trend.length);
    setActive(Math.min(trend.length - 1, Math.max(0, index)));
  };
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = trend.length - 1;
    const next =
      event.key === "ArrowRight"
        ? Math.min(last, (active ?? -1) + 1)
        : event.key === "ArrowLeft"
          ? Math.max(0, (active ?? trend.length) - 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  };

  const shown = active === null ? undefined : trend[active];

  return (
    <figure className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label={t("metric")}
          value={metric}
          onChange={(value) => {
            setMetric(value);
            setActive(null);
          }}
          options={(["money", "trips"] as const).map((value) => ({
            value,
            label: t(`metrics.${value}`),
          }))}
        />
        <span className="flex items-center gap-4 text-xs text-muted">
          {lines.map((line) => (
            <span key={line.key} className="flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2.5 rounded-xs", line.color)} />
              {t(line.key)}
            </span>
          ))}
        </span>
      </div>

      <div className="flex gap-3">
        {/* The axis: four steps from zero, compact ("12K"). */}
        <div
          aria-hidden
          className="flex h-64 flex-col justify-between pb-6 text-end text-xs text-muted tabular-nums"
        >
          {ticks.map((value) => (
            <span key={value} className="-my-2 leading-4">
              {axis(value)}
            </span>
          ))}
        </div>

        {/* Time runs left to right in both languages, like the axis it's read against. */}
        <div
          ref={plot}
          dir="ltr"
          tabIndex={0}
          role="group"
          aria-label={t("caption")}
          onPointerMove={pick}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive((was) => was ?? trend.length - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={move}
          className="relative h-64 min-w-0 flex-1 touch-pan-y rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 bottom-6 flex flex-col justify-between"
          >
            {ticks.map((value) => (
              <span
                key={value}
                className={cn(
                  "border-t border-border",
                  value === 0 ? "border-solid border-input" : "border-dashed",
                )}
              />
            ))}
          </div>

          <div aria-hidden className="absolute inset-x-0 top-0 bottom-6 flex">
            {trend.map((point, index) => (
              <div
                key={point.period}
                className={cn("relative flex h-full min-w-0 flex-1 items-end", gutter)}
              >
                {/* The hovered period lifts behind its bars. */}
                <span
                  className={cn(
                    "absolute inset-y-0 inset-x-px rounded-sm bg-surface-muted transition-opacity duration-150",
                    active === index ? "opacity-100" : "opacity-0",
                  )}
                />
                {stacked ? (
                  <div className="relative flex h-full w-full flex-col-reverse items-center gap-0.5">
                    {lines.map((line, order) => {
                      const value = line.value(point);
                      return (
                        value > 0 && (
                          <motion.span
                            key={`${metric}-${line.key}`}
                            className={cn(
                              "block w-full max-w-8 shrink-0",
                              line.color,
                              // The top of the stack is rounded; the bottom sits flat on the baseline.
                              (order === 1 || lines[1].value(point) === 0) && "rounded-t-[4px]",
                            )}
                            initial={{ height: 0 }}
                            animate={{ height: `${String((value / max) * 100)}%` }}
                            transition={ease}
                          />
                        )
                      );
                    })}
                  </div>
                ) : (
                  <div className="relative flex h-full w-full items-end justify-center gap-0.5">
                    {lines.map((line) => (
                      <motion.span
                        key={`${metric}-${line.key}`}
                        className={cn("block max-w-6 min-w-0 flex-1 rounded-t-[4px]", line.color)}
                        initial={{ height: 0 }}
                        animate={{ height: `${String((line.value(point) / max) * 100)}%` }}
                        transition={ease}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div aria-hidden className="absolute inset-x-0 bottom-0 flex h-6">
            {trend.map((point, index) => (
              <span
                key={point.period}
                className="relative min-w-0 flex-1 pt-1.5 text-center text-xs whitespace-nowrap text-muted"
              >
                {index % every === 0 && (
                  <span className="absolute start-1/2 -translate-x-1/2">{tick(point.period)}</span>
                )}
              </span>
            ))}
          </div>

          {empty && (
            <p className="pointer-events-none absolute inset-x-0 top-0 bottom-6 flex items-center justify-center text-sm text-muted">
              {t("empty")}
            </p>
          )}

          <AnimatePresence>
            {shown && active !== null && (
              <motion.div
                key="tip"
                role="status"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.12 }}
                // Beside the period, so it never covers the bars it describes: to its right, or to its left near the end.
                style={
                  active / trend.length > 0.6
                    ? { left: `${String((active / trend.length) * 100)}%` }
                    : { left: `${String(((active + 1) / trend.length) * 100)}%` }
                }
                className={cn(
                  "pointer-events-none absolute top-2 z-10 w-52 rounded-lg border border-border bg-surface p-3 shadow-lg",
                  active / trend.length > 0.6 ? "-ms-2 -translate-x-full" : "ms-2",
                )}
              >
                <Tip
                  title={title(shown.period)}
                  rows={
                    metric === "money"
                      ? [
                          { label: t("revenue"), value: money(shown.revenue), color: "bg-chart-1" },
                          { label: t("costs"), value: money(shown.expenses), color: "bg-chart-2" },
                          { label: t("margin"), value: money(shown.margin) },
                        ]
                      : [
                          {
                            label: t("completed"),
                            value: format.number(shown.completed),
                            color: "bg-chart-1",
                          },
                          {
                            label: t("cancelled"),
                            value: format.number(shown.cancelled),
                            color: "bg-chart-2",
                          },
                          { label: t("allTrips"), value: format.number(shown.trips) },
                        ]
                  }
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* The chart as a table, for screen readers. */}
      <table className="sr-only">
        <caption>{t("caption")}</caption>
        <thead>
          <tr>
            <th>{t("period")}</th>
            <th>{t("revenue")}</th>
            <th>{t("costs")}</th>
            <th>{t("completed")}</th>
            <th>{t("cancelled")}</th>
          </tr>
        </thead>
        <tbody>
          {trend.map((point) => (
            <tr key={point.period}>
              <td>{title(point.period)}</td>
              <td>{money(point.revenue)}</td>
              <td>{money(point.expenses)}</td>
              <td>{point.completed}</td>
              <td>{point.cancelled}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

// The period, then each figure: the value leads, the name follows, keyed by a short stroke of its series' colour.
function Tip({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: string; color?: string }[];
}) {
  return (
    <div className="flex flex-col gap-2" dir="auto">
      <p className="text-xs font-medium text-muted">{title}</p>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li
            key={row.label}
            className={cn(
              "flex items-center gap-2 text-xs",
              !row.color && "border-t border-border pt-1.5",
            )}
          >
            <span
              aria-hidden
              className={cn("h-0.5 w-3 shrink-0 rounded-full", row.color ?? "bg-transparent")}
            />
            <span className="flex-1 text-muted">{row.label}</span>
            <span className="font-semibold text-foreground tabular-nums" dir="ltr">
              {row.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
