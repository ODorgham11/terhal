"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  IconChevronRight,
  IconCircleCheck,
  IconCopy,
  IconPencil,
  IconDotsVertical,
  IconLink,
  IconPlayerPlay,
  IconPlayerStop,
  IconRotate,
  IconTag,
  IconUserPlus,
  IconX,
} from "@tabler/icons-react";
import type { Staff, TripDetail } from "@terhal/contracts";
import { DirectionalIcon } from "@/components/DirectionalIcon";
import { RequireStaff } from "@/components/session/RequireSession";
import { useRoute, useTripDates } from "@/components/staff/trips/format";
import { TripStatusBadge } from "@/components/staff/trips/TripStatusBadge";
import { AssignDialog } from "@/components/staff/trips/detail/AssignDialog";
import { EditTripDrawer } from "@/components/staff/trips/detail/EditTripDrawer";
import { CancelTripDialog } from "@/components/staff/trips/detail/CancelTripDialog";
import { ConfirmDialog } from "@/components/staff/ConfirmDialog";
import { LinkReturnDialog } from "@/components/staff/trips/detail/LinkReturnDialog";
import { ProposePriceDialog } from "@/components/staff/trips/detail/ProposePriceDialog";
import { ReportLinkDialog } from "@/components/staff/trips/detail/ReportLinkDialog";
import {
  ActivityCard,
  AssignmentCard,
  BookerCard,
  PriceCard,
  ReportCard,
  ReturnTripCard,
  RouteCard,
} from "@/components/staff/trips/detail/TripCards";
import { tripKey, useTripChanged } from "@/components/staff/trips/detail/cache";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { fade } from "@/components/ui/Motion";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { call, isApiError, staffApi, useErrorMessage } from "@/lib/api";

type DialogName =
  | "edit"
  | "price"
  | "confirm"
  | "assign"
  | "start"
  | "end"
  | "unstart"
  | "complete"
  | "reopen"
  | "cancel"
  | "reportLink"
  | "linkReturn"
  | "unlink";

export function TripDetailPage({ id }: { id: string }) {
  return (
    <RequireStaff permission="trips">{(staff) => <Detail id={id} staff={staff} />}</RequireStaff>
  );
}

function Detail({ id, staff }: { id: string; staff: Staff }) {
  const t = useTranslations("staff.trips.detail");
  const errorMessage = useErrorMessage();
  const trip = useQuery({
    queryKey: tripKey(id),
    queryFn: () => call(staffApi.trips[":id"].$get({ param: { id } })),
    retry: (count, error) => !(isApiError(error) && error.status === 404) && count < 1,
  });

  if (trip.isPending) return <DetailLoading />;
  if (trip.isError) {
    return (
      <EmptyState
        title={
          isApiError(trip.error) && trip.error.status === 404
            ? t("notFound")
            : errorMessage(trip.error)
        }
        action={
          <Button asChild variant="secondary">
            <Link href="/trips">{t("backToTrips")}</Link>
          </Button>
        }
      />
    );
  }
  return <Loaded trip={trip.data} staff={staff} />;
}

// The page's own shape in gray: breadcrumb, header and both columns of cards.
function DetailLoading() {
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
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-5.5 w-24 rounded-full" />
            <Skeleton className="h-5.5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-5 w-80 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="size-10 rounded-lg" />
          <Skeleton className="h-10 w-36 rounded-lg" />
        </div>
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22.5rem]">
        <div className="flex min-w-0 flex-col gap-5">{[6, 5].map(card)}</div>
        <div className="flex flex-col gap-5">{[3, 2, 3, 2].map(card)}</div>
      </div>
    </motion.div>
  );
}

function Loaded({ trip, staff }: { trip: TripDetail; staff: Staff }) {
  const t = useTranslations("staff.trips.detail");
  const nav = useTranslations("staff.nav");
  const route = useRoute();
  const { dateTime } = useTripDates();
  const changed = useTripChanged();
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const open = (name: DialogName) => () => setDialog(name);
  // Details change while pending or confirmed; the price, payment and brand until the trip is completed.
  const editable = trip.status !== "COMPLETED" && trip.status !== "CANCELLED";
  const dialogProps = (name: DialogName) => ({
    open: dialog === name,
    onOpenChange: (next: boolean) => setDialog(next ? name : null),
  });

  // The lifecycle steps that take no input: one request, then reload.
  const step =
    (path: "confirm" | "start" | "end" | "unstart" | "complete" | "reopen") => async () => {
      const endpoint = staffApi.trips[":id"][path];
      await call(endpoint.$post({ param: { id: trip.id } }));
      await changed(trip.id);
      toast.success(t(`done.${path}`));
    };
  const unlink = async () => {
    const other = trip.returnTrip ?? trip.previousTrip;
    await call(staffApi.trips[":id"].link.$delete({ param: { id: trip.id } }));
    await Promise.all([changed(trip.id), other && changed(other.id)]);
  };

  const { status, priceState } = trip;
  const unassigned = !trip.driver && !trip.vehicle && !trip.office;
  const needsPrice =
    status === "PENDING" && (priceState === "REQUESTED" || priceState === "PROPOSED");
  const assignable = status === "PENDING" || status === "CONFIRMED";
  const canCancel = status === "PENDING" || status === "CONFIRMED";
  const hasReportLink =
    Boolean(trip.driver) &&
    (status === "CONFIRMED" || status === "IN_PROGRESS" || status === "AWAITING_REPORT");
  const linkable = status !== "CANCELLED" && status !== "COMPLETED";

  // The one thing to do next, as the page's main button.
  const primary =
    status === "PENDING"
      ? needsPrice
        ? {
            label: priceState === "PROPOSED" ? t("actions.changePrice") : t("actions.proposePrice"),
            icon: IconTag,
            onClick: open("price"),
          }
        : { label: t("actions.confirm"), icon: IconCircleCheck, onClick: open("confirm") }
      : status === "CONFIRMED"
        ? unassigned
          ? { label: t("actions.assign"), icon: IconUserPlus, onClick: open("assign") }
          : { label: t("actions.start"), icon: IconPlayerPlay, onClick: open("start") }
        : status === "IN_PROGRESS"
          ? { label: t("actions.end"), icon: IconPlayerStop, onClick: open("end") }
          : status === "AWAITING_REPORT"
            ? { label: t("actions.complete"), icon: IconCircleCheck, onClick: open("complete") }
            : null;

  const banner =
    status === "PENDING" && priceState === "REQUESTED"
      ? { tone: "warning" as const, text: t("banners.priceRequested") }
      : status === "PENDING" && priceState === "PROPOSED"
        ? { tone: "info" as const, text: t("banners.priceProposed") }
        : status === "CONFIRMED" && unassigned
          ? { tone: "warning" as const, text: t("banners.unassigned") }
          : status === "AWAITING_REPORT"
            ? trip.report
              ? { tone: "info" as const, text: t("banners.reportSent") }
              : {
                  tone: "warning" as const,
                  text: trip.driver ? t("banners.reportMissing") : t("banners.officeTrip"),
                }
            : status === "CANCELLED"
              ? { tone: "danger" as const, text: t("banners.cancelled") }
              : null;

  return (
    <>
      <nav aria-label={t("breadcrumb")} className="flex items-center gap-2 text-xs">
        <Link href="/trips" className="text-primary hover:underline">
          {nav("trips")}
        </Link>
        <DirectionalIcon icon={IconChevronRight} className="size-3.5 text-muted" />
        <span className="text-muted" dir="ltr">
          {trip.code}
        </span>
      </nav>

      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-foreground" dir="ltr">
              {trip.code}
            </h1>
            <TripStatusBadge status={status} />
            <Badge tone="neutral" title={t("brandHint")}>
              {trip.brand ? trip.brand.nameEn : t("terhal")}
            </Badge>
          </div>
          <p className="text-base text-muted">
            {route(trip)} · {dateTime(trip.pickupDate)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" aria-label={t("moreActions")}>
                <IconDotsVertical aria-hidden className="size-5" stroke={1.75} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {editable && (
                <DropdownMenuItem onSelect={open("edit")}>
                  <IconPencil aria-hidden className="size-4" stroke={1.75} />
                  {t("actions.edit")}
                </DropdownMenuItem>
              )}
              {assignable && !unassigned && (
                <DropdownMenuItem onSelect={open("assign")}>
                  <IconUserPlus aria-hidden className="size-4" stroke={1.75} />
                  {t("actions.changeAssignment")}
                </DropdownMenuItem>
              )}
              {status === "IN_PROGRESS" && (
                <DropdownMenuItem onSelect={open("unstart")}>
                  <IconRotate aria-hidden className="size-4" stroke={1.75} />
                  {t("actions.unstart")}
                </DropdownMenuItem>
              )}
              {status === "COMPLETED" && (
                <DropdownMenuItem onSelect={open("reopen")}>
                  <IconRotate aria-hidden className="size-4" stroke={1.75} />
                  {t("actions.reopen")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() => {
                  void navigator.clipboard
                    .writeText(trip.code)
                    .then(() => toast.success(t("copied")));
                }}
              >
                <IconCopy aria-hidden className="size-4" stroke={1.75} />
                {t("actions.copyCode")}
              </DropdownMenuItem>
              {canCancel && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={open("cancel")}>
                    <IconX aria-hidden className="size-4" stroke={1.75} />
                    {t("actions.cancel")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {hasReportLink && (
            <Button variant="secondary" onClick={open("reportLink")}>
              <IconLink aria-hidden className="size-5" stroke={1.75} />
              {t("actions.reportLink")}
            </Button>
          )}
          {primary && (
            <Button onClick={primary.onClick}>
              <primary.icon aria-hidden className="size-5" stroke={1.75} />
              {primary.label}
            </Button>
          )}
        </div>
      </header>

      {/* The banner changes with each step (priced, confirmed, ended): it fades across instead of flicking. */}
      <AnimatePresence initial={false} mode="popLayout">
        {banner && (
          <motion.div key={banner.text} {...fade}>
            <Alert tone={banner.tone} title={banner.text} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22.5rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <RouteCard trip={trip} />
          {trip.report && <ReportCard trip={trip} />}
          <ActivityCard events={trip.events} />
        </div>
        <div className="flex flex-col gap-5">
          <BookerCard trip={trip} />
          <PriceCard trip={trip} />
          <AssignmentCard trip={trip} onChange={assignable ? open("assign") : undefined} />
          <ReturnTripCard
            trip={trip}
            onLink={linkable && !trip.previousTrip ? open("linkReturn") : undefined}
            onUnlink={linkable ? open("unlink") : undefined}
          />
        </div>
      </div>

      <ProposePriceDialog
        trip={trip}
        canSaveToPricing={staff.permissions.includes("pricing")}
        {...dialogProps("price")}
      />
      <AssignDialog trip={trip} {...dialogProps("assign")} />
      <CancelTripDialog trip={trip} {...dialogProps("cancel")} />
      <EditTripDrawer trip={trip} {...dialogProps("edit")} />
      <ReportLinkDialog trip={trip} {...dialogProps("reportLink")} />
      <LinkReturnDialog trip={trip} {...dialogProps("linkReturn")} />
      <ConfirmDialog
        {...dialogProps("confirm")}
        title={t("confirmTrip.title", { code: trip.code })}
        description={t("confirmTrip.description")}
        confirmLabel={t("actions.confirm")}
        onConfirm={step("confirm")}
      />
      <ConfirmDialog
        {...dialogProps("start")}
        title={t("startTrip.title")}
        description={t("startTrip.description")}
        confirmLabel={t("actions.start")}
        onConfirm={step("start")}
      />
      <ConfirmDialog
        {...dialogProps("end")}
        title={t("endTrip.title")}
        description={t("endTrip.description")}
        confirmLabel={t("actions.end")}
        onConfirm={step("end")}
      />
      <ConfirmDialog
        {...dialogProps("unstart")}
        title={t("unstartTrip.title")}
        description={t("unstartTrip.description")}
        confirmLabel={t("actions.unstart")}
        onConfirm={step("unstart")}
      />
      <ConfirmDialog
        {...dialogProps("complete")}
        title={t("completeTrip.title")}
        description={
          trip.driver ? t("completeTrip.description") : t("completeTrip.officeDescription")
        }
        confirmLabel={t("actions.complete")}
        onConfirm={step("complete")}
      />
      <ConfirmDialog
        {...dialogProps("reopen")}
        title={t("reopenTrip.title")}
        description={t("reopenTrip.description")}
        confirmLabel={t("actions.reopen")}
        tone="danger"
        onConfirm={step("reopen")}
      />
      <ConfirmDialog
        {...dialogProps("unlink")}
        title={t("unlinkTrip.title")}
        description={t("unlinkTrip.description")}
        confirmLabel={t("returnTripUnlink")}
        tone="danger"
        onConfirm={unlink}
      />
    </>
  );
}
