"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  IconBuildingStore,
  IconCalendar,
  IconCar,
  IconLink,
  IconLuggage,
  IconUnlink,
  IconUsers,
  type Icon,
} from "@tabler/icons-react";
import type { TripDetail, TripEvent } from "@terhal/contracts";
import { Avatar } from "@/components/staff/Avatar";
import { SectionCard } from "@/components/staff/SectionCard";
import { Button } from "@/components/ui/Button";
import { call, staffApi } from "@/lib/api";
import { cn } from "@/lib/cn";
import { whatsappLink } from "@/lib/whatsapp";
import { useLocalName, useTripDates } from "../format";
import { TripStatusBadge } from "../TripStatusBadge";

function Chip({ icon: Icon, label, value }: { icon: Icon; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-surface-muted px-3 py-2">
      <Icon aria-hidden className="size-4.5 shrink-0 text-muted" stroke={1.75} />
      <div className="flex min-w-0 flex-col">
        <span className="text-xs text-muted">{label}</span>
        <span className="truncate text-sm font-medium text-foreground">{value}</span>
      </div>
    </div>
  );
}

export function RouteCard({ trip }: { trip: TripDetail }) {
  const t = useTranslations("staff.trips.detail.route");
  const trips = useTranslations("staff.trips");
  const name = useLocalName();
  const { dateTime } = useTripDates();
  const luggage = trip.largeLuggage + trip.mediumLuggage + trip.smallLuggage;

  return (
    <SectionCard title={t("title")}>
      <ol className="relative flex flex-col gap-4 ps-6">
        <span aria-hidden className="absolute start-1.5 top-2 bottom-8 w-px bg-border" />
        {(["pickup", "dropoff"] as const).map((end) => (
          <li key={end} className="relative flex flex-col">
            <span
              aria-hidden
              className={cn(
                "absolute -start-6 top-0.5 size-3 rounded-full border-[3px] bg-surface",
                end === "pickup" ? "border-primary" : "border-accent",
              )}
            />
            <span className="text-xs text-muted">{t(end)}</span>
            <span className="text-sm font-medium text-foreground">{name(trip[end])}</span>
          </li>
        ))}
      </ol>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Chip icon={IconCalendar} label={t("pickupTime")} value={dateTime(trip.pickupDate)} />
        <Chip
          icon={IconCar}
          label={t("class")}
          value={`${name(trip.class)} · ${trips(`car.${trip.car}`)}`}
        />
        <Chip icon={IconUsers} label={t("passengers")} value={trip.passengers} />
        <Chip
          icon={IconLuggage}
          label={t("luggage")}
          value={
            luggage === 0
              ? t("noLuggage")
              : t("luggageDetail", {
                  large: trip.largeLuggage,
                  medium: trip.mediumLuggage,
                  small: trip.smallLuggage,
                })
          }
        />
        {trip.office && (
          <Chip icon={IconBuildingStore} label={t("office")} value={trip.office.name} />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted">{t("passenger")}</span>
        <span className="text-sm text-foreground">
          {trip.clientName} ·{" "}
          <a
            href={whatsappLink(trip.clientPhone)}
            target="_blank"
            rel="noreferrer"
            dir="ltr"
            className="text-primary hover:underline"
          >
            {trip.clientPhone}
          </a>
        </span>
      </div>
      {trip.notes && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">{t("notes")}</span>
          <p className="text-sm whitespace-pre-line text-foreground">{trip.notes}</p>
        </div>
      )}
    </SectionCard>
  );
}

export function ReportCard({ trip }: { trip: TripDetail }) {
  const t = useTranslations("staff.trips.detail.report");
  const { dateTime, price } = useTripDates();
  const format = useFormatter();
  const report = useQuery({
    queryKey: ["staff", "trip", trip.id, "report"],
    queryFn: () => call(staffApi.trips[":id"].report.$get({ param: { id: trip.id } })),
  });

  if (!report.data) return null;
  const { cashCollected, expenses } = report.data;
  const fee = expenses.filter((expense) => expense.type === "DRIVER_FEE");
  const others = expenses.filter((expense) => expense.type !== "DRIVER_FEE");
  const sum = (list: { amount: string }[]) =>
    list.reduce((total, item) => total + Number(item.amount), 0);
  const feeTotal = sum(fee);
  const otherTotal = sum(others);
  // Office fees are paid by the office, not the driver, so they stay out of what the driver is owed.
  const paidByDriver = sum(others.filter((expense) => expense.type !== "OFFICE_FEE"));
  const net = Number(cashCollected) - feeTotal - paidByDriver;
  const amount = (value: number) => price(value.toFixed(2));
  const km = report.data.endMileage - report.data.startMileage;

  return (
    <SectionCard
      title={t("title")}
      aside={
        <span className="text-xs text-muted">
          {t("sent", { date: dateTime(report.data.submittedAt) })}
        </span>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure label={t("cash")} value={price(cashCollected)} />
        <Figure label={t("driverFee")} value={amount(feeTotal)} />
        <Figure
          label={net >= 0 ? t("netOwedByDriver") : t("netOwedToDriver")}
          value={amount(Math.abs(net))}
          highlight
        />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <dt className="text-muted">{t("started")}</dt>
        <dd className="text-foreground">{dateTime(report.data.startedAt)}</dd>
        <dt className="text-muted">{t("ended")}</dt>
        <dd className="text-foreground">{dateTime(report.data.endedAt)}</dd>
        <dt className="text-muted">{t("distance")}</dt>
        <dd className="text-foreground">{t("km", { km: format.number(km) })}</dd>
        <dt className="text-muted">{t("stops")}</dt>
        <dd className="text-foreground">{report.data.stops.length}</dd>
      </dl>
      {others.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted">{t("expenses")}</span>
          <ul className="flex flex-col gap-1.5">
            {others.map((expense) => (
              <li key={expense.id} className="flex justify-between gap-4 text-sm">
                <span className="text-muted">
                  {t(`expenseTypes.${expense.type}`)}
                  {expense.notes && ` · ${expense.notes}`}
                </span>
                <span className="text-foreground tabular-nums">{price(expense.amount)}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between gap-4 border-t border-border pt-2 text-sm">
            <span className="text-muted">{t("totalExpenses")}</span>
            <span className="font-medium text-foreground tabular-nums">{amount(otherTotal)}</span>
          </div>
        </div>
      )}
      <p className="text-xs text-muted">{t("netFormula")}</p>
    </SectionCard>
  );
}

function Figure({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg p-4",
        highlight ? "bg-primary-soft" : "bg-surface-muted",
      )}
    >
      <span className="text-xs text-muted">{label}</span>
      <span
        className={cn(
          "text-2xl font-semibold tabular-nums",
          highlight ? "text-primary" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

const eventKeys: Record<string, string> = {
  "trip.created": "created",
  "trip.updated": "updated",
  "trip.price_proposed": "priceProposed",
  "trip.price_accepted": "priceAccepted",
  "trip.price_declined": "priceDeclined",
  "trip.confirmed": "confirmed",
  "trip.assigned": "assigned",
  "trip.unassigned": "unassigned",
  "trip.started": "started",
  "trip.start_undone": "startUndone",
  "trip.ended": "ended",
  "trip.completed": "completed",
  "trip.reopened": "reopened",
  "trip.cancelled": "cancelled",
  "trip.report_link_issued": "reportLinkIssued",
  "trip.report_submitted": "reportSubmitted",
  "trip.report_edited": "reportEdited",
  "trip.payment_recorded": "paymentRecorded",
  "trip.linked": "linked",
  "trip.unlinked": "unlinked",
};

export function ActivityCard({ events }: { events: TripEvent[] }) {
  const t = useTranslations("staff.trips.detail.activity");
  const { dateTime } = useTripDates();
  const newestFirst = [...events].reverse();

  return (
    <SectionCard title={t("title")}>
      <ol className="flex flex-col gap-4">
        {newestFirst.map((event) => (
          <li key={event.id} className="flex gap-3">
            <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium text-foreground">
                {t(`events.${eventKeys[event.action] ?? "updated"}` as "events.updated")}
              </span>
              <span className="text-xs text-muted">
                {event.actor.type === "SYSTEM" ? t("system") : event.actor.name}
                {event.actor.type === "DRIVER" && ` · ${t("viaReportLink")}`}
              </span>
            </div>
            <time dateTime={event.createdAt} className="shrink-0 text-xs text-muted">
              {dateTime(event.createdAt)}
            </time>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}

export function BookerCard({ trip }: { trip: TripDetail }) {
  const t = useTranslations("staff.trips.detail.booker");
  const bookers = useTranslations("staff.trips.booker");
  const [first = "", last] = trip.booker.name.split(" ");

  return (
    <SectionCard title={t("title")}>
      <div className="flex items-center gap-2.5">
        <Avatar firstName={first} lastName={last} />
        <div className="flex min-w-0 flex-col">
          {trip.booker.type === "CUSTOMER" ? (
            <Link
              href={`/customers/${trip.booker.id}`}
              className="truncate text-sm font-medium text-foreground hover:underline"
            >
              {trip.booker.name}
            </Link>
          ) : (
            <span className="truncate text-sm font-medium text-foreground">{trip.booker.name}</span>
          )}
          <span className="text-xs text-muted">{bookers(trip.booker.type)}</span>
        </div>
      </div>
      <dl className="flex flex-col gap-2 text-sm">
        {trip.booker.phone && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">{t("phone")}</dt>
            <dd dir="ltr">
              <a
                href={whatsappLink(trip.booker.phone)}
                target="_blank"
                rel="noreferrer"
                className="text-foreground hover:underline"
              >
                {trip.booker.phone}
              </a>
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <dt className="text-muted">{t("email")}</dt>
          <dd dir="ltr" className="min-w-0 truncate">
            <a href={`mailto:${trip.booker.email}`} className="text-foreground hover:underline">
              {trip.booker.email}
            </a>
          </dd>
        </div>
      </dl>
    </SectionCard>
  );
}

export function PriceCard({ trip }: { trip: TripDetail }) {
  const t = useTranslations("staff.trips.detail.price");
  const { price } = useTripDates();

  return (
    <SectionCard title={t("title")} contentClassName="gap-1">
      {trip.totalPrice === null ? (
        <p className="text-sm font-medium text-accent">{t("requested")}</p>
      ) : (
        <p className="text-2xl leading-8 font-semibold text-foreground tabular-nums">
          {price(trip.totalPrice)}
        </p>
      )}
      <p className="text-xs text-muted">{t(`states.${trip.priceState}`)}</p>
      {trip.paymentMethod && (
        <p className="text-sm text-foreground">
          {t(`payment.${trip.paymentMethod}`)}
          {trip.paidAt && ` · ${t("paid")}`}
        </p>
      )}
    </SectionCard>
  );
}

export function AssignmentCard({
  trip,
  onChange,
}: {
  trip: TripDetail;
  // Absent once the assignment can't change (started, finished, cancelled).
  onChange?: () => void;
}) {
  const t = useTranslations("staff.trips.detail.assignment");
  const assignment = useTranslations("staff.trips.assignment");
  const empty = !trip.driver && !trip.vehicle && !trip.office;

  return (
    <SectionCard
      title={t("title")}
      aside={
        onChange &&
        !empty && (
          <Button variant="ghost" size="sm" onClick={onChange}>
            {t("change")}
          </Button>
        )
      }
    >
      {empty ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-warning">{assignment("unassigned")}</p>
          {onChange && (
            <Button variant="secondary" onClick={onChange}>
              {t("assign")}
            </Button>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {trip.office && (
            <Person
              icon={IconBuildingStore}
              title={trip.office.name}
              detail={assignment("partnerOffice")}
            />
          )}
          {trip.driver && (
            <li className="flex items-center gap-2.5">
              <Avatar firstName={trip.driver.firstName} lastName={trip.driver.lastName} />
              <div className="flex min-w-0 flex-col">
                <Link
                  href={`/drivers/${trip.driver.id}`}
                  className="truncate text-sm font-medium text-foreground hover:underline"
                >
                  {trip.driver.firstName} {trip.driver.lastName}
                </Link>
                <a
                  href={whatsappLink(trip.driver.phone)}
                  target="_blank"
                  rel="noreferrer"
                  dir="ltr"
                  className="text-start text-xs text-muted hover:underline"
                >
                  {trip.driver.phone}
                </a>
              </div>
            </li>
          )}
          {trip.vehicle && (
            <Person
              icon={IconCar}
              title={`${trip.vehicle.make} ${trip.vehicle.model}`}
              detail={`${trip.vehicle.plateNumber} · ${trip.vehicle.color}`}
            />
          )}
        </ul>
      )}
    </SectionCard>
  );
}

function Person({ icon: Icon, title, detail }: { icon: Icon; title: string; detail: string }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-muted">
        <Icon aria-hidden className="size-4" stroke={1.75} />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{title}</span>
        <span className="truncate text-xs text-muted">{detail}</span>
      </div>
    </li>
  );
}

export function ReturnTripCard({
  trip,
  onLink,
  onUnlink,
}: {
  trip: TripDetail;
  onLink?: () => void;
  onUnlink?: () => void;
}) {
  const t = useTranslations("staff.trips.detail.returnTrip");
  const { dateTime } = useTripDates();
  const other = trip.returnTrip ?? trip.previousTrip;

  return (
    <SectionCard title={trip.previousTrip ? t("outboundTitle") : t("title")}>
      {other ? (
        <>
          <Link
            href={`/trips/${other.id}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 hover:bg-surface-muted"
          >
            <span className="flex flex-col">
              <span className="text-sm font-medium text-primary" dir="ltr">
                {other.code}
              </span>
              <span className="text-xs text-muted">{dateTime(other.pickupDate)}</span>
            </span>
            <TripStatusBadge status={other.status} />
          </Link>
          {/* At the foot of the card, on gray, so it reads as a separate action rather than part of the link. */}
          {onUnlink && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onUnlink}
              className="self-end bg-surface-muted text-muted hover:bg-border hover:text-foreground"
            >
              <IconUnlink aria-hidden className="size-4" stroke={1.75} />
              {t("unlink")}
            </Button>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">{t("none")}</p>
          {onLink && (
            <Button variant="secondary" onClick={onLink}>
              <IconLink aria-hidden className="size-5" stroke={1.75} />
              {t("link")}
            </Button>
          )}
        </div>
      )}
    </SectionCard>
  );
}
