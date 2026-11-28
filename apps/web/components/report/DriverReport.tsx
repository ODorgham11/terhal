"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import Image from "next/image";
import { useFormatter, useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  IconAlertTriangle,
  IconBan,
  IconCircleCheck,
  IconClockHour4,
  IconLinkOff,
  IconBrandWhatsapp,
  IconPlayerPlay,
  IconPlayerStop,
  IconRoute,
  IconWifiOff,
  type Icon,
} from "@tabler/icons-react";
import type { DriverTrip } from "@terhal/contracts";
import logo from "@/assets/logo.png";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { ConfirmDialog } from "@/components/staff/ConfirmDialog";
import { TripStatusBadge } from "@/components/staff/trips/TripStatusBadge";
import { useLocalName, useRoute, useTripDates } from "@/components/staff/trips/format";
import { Button } from "@/components/ui/Button";
import { Swap, fade } from "@/components/ui/Motion";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { call, isApiError, siteApi } from "@/lib/api";
import { cn } from "@/lib/cn";
import { whatsappLink } from "@/lib/whatsapp";
import { reportKey } from "./keys";
import { ReportForm } from "./ReportForm";
import { ReportSummary } from "./ReportSummary";

// The page a driver opens from the link the office sends: /report#<token>. The token sits in the fragment, which never
// reaches a server (nor a referrer), and goes to the API in the Report-Token header. On a white page, phone first.

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
// null until the browser has read the fragment (the server can't see it).
const useToken = () =>
  useSyncExternalStore(
    subscribe,
    () => decodeURIComponent(window.location.hash.slice(1)).trim(),
    () => null,
  );

export function DriverReport() {
  return (
    // White, and light whatever the phone's setting (data-theme="light" opts out of the dark theme in globals.css).
    <div data-theme="light" className="flex min-h-dvh flex-col bg-white">
      <header className="sticky top-0 z-30 border-b border-border bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-xl items-center justify-between gap-4 px-4">
          <Image src={logo} alt="" className="h-7 w-auto" priority />
          <LocaleSwitcher />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6">
        <Report />
      </main>
    </div>
  );
}

function Report() {
  const t = useTranslations("report");
  const token = useToken();
  const trip = useQuery({
    queryKey: reportKey(token ?? ""),
    queryFn: () => call(siteApi.driver.report.$get({ header: { "report-token": token ?? "" } })),
    enabled: !!token,
    // A link that's wrong stays wrong; only a dropped connection is worth another go.
    retry: (count, error) => isApiError(error) && error.code === "NETWORK_ERROR" && count < 2,
    refetchOnWindowFocus: false,
  });

  const state =
    token === null || (token && trip.isPending)
      ? "loading"
      : !token
        ? "missing"
        : trip.isError
          ? "error"
          : "trip";

  return (
    <Swap state={state}>
      {state === "loading" ? (
        <ReportLoading />
      ) : state === "missing" ? (
        <StateCard icon={IconLinkOff} tone="danger" {...copy(t, "missing")} />
      ) : trip.isError ? (
        <LinkError error={trip.error} onRetry={() => void trip.refetch()} />
      ) : trip.data && token ? (
        <TripPage trip={trip.data} token={token} />
      ) : null}
    </Swap>
  );
}

const copy = (t: ReturnType<typeof useTranslations<"report">>, key: string) => ({
  title: t(`states.${key}.title` as "states.missing.title"),
  body: t(`states.${key}.body` as "states.missing.body"),
});

function LinkError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const t = useTranslations("report");
  const code = isApiError(error) ? error.code : "UNEXPECTED_RESPONSE";
  if (code === "REPORT_LINK_INVALID") {
    return <StateCard icon={IconLinkOff} tone="danger" {...copy(t, "invalid")} />;
  }
  if (code === "REPORT_LINK_EXPIRED") {
    return <StateCard icon={IconClockHour4} tone="warning" {...copy(t, "expired")} />;
  }
  return (
    <StateCard
      icon={code === "RATE_LIMITED" ? IconAlertTriangle : IconWifiOff}
      tone="warning"
      {...copy(t, code === "RATE_LIMITED" ? "limited" : "failed")}
      action={
        <Button variant="secondary" onClick={onRetry}>
          {t("states.failed.retry")}
        </Button>
      }
    />
  );
}

const tones = {
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  muted: "bg-surface-muted text-muted",
};

// Where the trip stands and the one thing to do about it.
function StateCard({
  icon: StateIcon,
  tone,
  title,
  body,
  action,
}: {
  icon: Icon;
  tone: keyof typeof tones;
  title: ReactNode;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-white p-5 shadow-xs">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full",
            tones[tone],
          )}
        >
          <StateIcon aria-hidden className="size-5" stroke={1.75} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          <p className="text-sm text-muted">{body}</p>
        </div>
      </div>
      {action}
    </section>
  );
}

function TripPage({ trip, token }: { trip: DriverTrip; token: string }) {
  const t = useTranslations("report");
  const format = useFormatter();
  const client = useQueryClient();
  const [confirming, setConfirming] = useState<"start" | "end" | null>(null);

  const act = async (step: "start" | "end") => {
    const endpoint = siteApi.driver.report[step];
    const next = await call(endpoint.$post({ header: { "report-token": token } }));
    client.setQueryData(reportKey(token), next);
    toast.success(t(step === "start" ? "states.confirmed.done" : "states.inProgress.done"));
  };

  const { status, report } = trip;
  const stage = report
    ? status === "COMPLETED"
      ? "completed"
      : "sent"
    : status === "CANCELLED"
      ? "cancelled"
      : status === "PENDING"
        ? "pending"
        : status === "CONFIRMED"
          ? "confirmed"
          : status === "IN_PROGRESS"
            ? "inProgress"
            : status === "AWAITING_REPORT"
              ? "awaiting"
              : "completed";
  const fillsReport = !report && (status === "IN_PROGRESS" || status === "AWAITING_REPORT");
  const beforeEnd = !report && (status === "CONFIRMED" || status === "IN_PROGRESS");

  const stateCard = {
    completed: <StateCard icon={IconCircleCheck} tone="success" {...copy(t, "completed")} />,
    sent: <StateCard icon={IconCircleCheck} tone="success" {...copy(t, "sent")} />,
    cancelled: <StateCard icon={IconBan} tone="danger" {...copy(t, "cancelled")} />,
    pending: <StateCard icon={IconClockHour4} tone="muted" {...copy(t, "pending")} />,
    awaiting: <StateCard icon={IconRoute} tone="primary" {...copy(t, "awaiting")} />,
    confirmed: (
      <StateCard
        icon={IconPlayerPlay}
        tone="primary"
        {...copy(t, "confirmed")}
        action={
          <Button size="lg" onClick={() => setConfirming("start")}>
            <IconPlayerPlay aria-hidden className="size-5" stroke={1.75} />
            {t("states.confirmed.action")}
          </Button>
        }
      />
    ),
    inProgress: (
      <StateCard
        icon={IconRoute}
        tone="primary"
        {...copy(t, "inProgress")}
        action={
          <Button size="lg" variant="secondary" onClick={() => setConfirming("end")}>
            <IconPlayerStop aria-hidden className="size-5" stroke={1.75} />
            {t("states.inProgress.action")}
          </Button>
        }
      />
    ),
  }[stage];

  return (
    <motion.div {...fade} className="flex flex-col gap-4">
      <Swap state={stage}>{stateCard}</Swap>
      {/* Before the trip ends, the trip comes first, with a way to reach the passenger. After it, the report does: the
          driver is reporting, not contacting anyone, so the trip is only there for reference. */}
      {beforeEnd ? (
        <>
          <TripCard trip={trip} contact />
          {fillsReport && <ReportForm trip={trip} token={token} />}
        </>
      ) : (
        <>
          {fillsReport && <ReportForm trip={trip} token={token} />}
          {report && <ReportSummary report={report} />}
          <TripCard trip={trip} />
        </>
      )}
      <p className="text-center text-xs text-muted">
        {t("linkExpires", {
          date: format.dateTime(new Date(trip.linkExpiresAt), {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }),
        })}{" "}
        {t("help")}
      </p>

      <ConfirmDialog
        open={confirming === "start"}
        onOpenChange={(open) => setConfirming(open ? "start" : null)}
        title={t("states.confirmed.confirmTitle")}
        description={t("states.confirmed.confirmBody")}
        confirmLabel={t("states.confirmed.action")}
        onConfirm={() => act("start")}
      />
      <ConfirmDialog
        open={confirming === "end"}
        onOpenChange={(open) => setConfirming(open ? "end" : null)}
        title={t("states.inProgress.confirmTitle")}
        description={t("states.inProgress.confirmBody")}
        confirmLabel={t("states.inProgress.action")}
        onConfirm={() => act("end")}
      />
    </motion.div>
  );
}

// What the driver needs on the road: where, when, who, in what.
function TripCard({ trip, contact = false }: { trip: DriverTrip; contact?: boolean }) {
  const t = useTranslations("report.trip");
  const cars = useTranslations("staff.trips.car");
  const name = useLocalName();
  const route = useRoute();
  const { dateTime } = useTripDates();
  const luggage = trip.largeLuggage + trip.mediumLuggage + trip.smallLuggage;

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-white p-5 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium text-primary" dir="ltr">
            {trip.code}
          </span>
          <span className="text-base font-semibold text-foreground">{route(trip)}</span>
        </div>
        <TripStatusBadge status={trip.status} />
      </div>

      <ol className="relative flex flex-col gap-4 ps-6">
        <span aria-hidden className="absolute start-1.5 top-2 bottom-8 w-px bg-border" />
        {(["pickup", "dropoff"] as const).map((end) => (
          <li key={end} className="relative flex flex-col">
            <span
              aria-hidden
              className={cn(
                "absolute -start-6 top-0.5 size-3 rounded-full border-[3px] bg-white",
                end === "pickup" ? "border-primary" : "border-accent",
              )}
            />
            <span className="text-xs text-muted">{t(end)}</span>
            <span className="text-sm font-medium text-foreground">{name(trip[end])}</span>
          </li>
        ))}
      </ol>

      <dl className="grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
        <Detail label={t("when")}>{dateTime(trip.pickupDate)}</Detail>
        <Detail label={t("car")}>
          {name(trip.class)} · {cars(trip.car)}
        </Detail>
        <Detail label={t("passenger")}>
          {trip.clientName}
          <span className="block text-xs text-muted">
            {t("load", { passengers: trip.passengers, luggage })}
          </span>
        </Detail>
        {trip.vehicle && (
          <Detail label={t("vehicle")}>
            {trip.vehicle.make} {trip.vehicle.model}
            <span className="block text-xs text-muted" dir="ltr">
              {trip.vehicle.plateNumber} · {trip.vehicle.color}
            </span>
          </Detail>
        )}
      </dl>

      {contact && (
        <Button asChild variant="secondary" size="lg">
          <a href={whatsappLink(trip.clientPhone)} target="_blank" rel="noreferrer">
            <IconBrandWhatsapp aria-hidden className="size-5 text-success" stroke={1.75} />
            {t("message", { name: trip.clientName.split(" ")[0] ?? trip.clientName })}
          </a>
        </Button>
      )}

      {trip.notes && (
        <div className="flex flex-col gap-1 rounded-lg bg-surface-muted p-3">
          <span className="text-xs text-muted">{t("notes")}</span>
          <p className="text-sm whitespace-pre-line text-foreground">{trip.notes}</p>
        </div>
      )}
    </section>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-medium text-foreground">{children}</dd>
    </div>
  );
}

function ReportLoading() {
  const t = useTranslations("report");
  return (
    <div role="status" className="flex flex-col gap-4">
      <span className="sr-only">{t("loading")}</span>
      <div className="flex items-start gap-3 rounded-2xl border border-border p-5">
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <div className="flex flex-1 flex-col gap-2 pt-1">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
        </div>
      </div>
      <div className="flex flex-col gap-4 rounded-2xl border border-border p-5">
        <div className="flex justify-between">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-5 w-52" />
          </div>
          <Skeleton className="h-5.5 w-24 rounded-full" />
        </div>
        <Skeleton className="h-16 w-full" />
        <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
          {[0, 1, 2, 3].map((cell) => (
            <div key={cell} className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-28" />
            </div>
          ))}
        </div>
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  );
}
