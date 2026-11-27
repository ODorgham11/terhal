"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  IconArchive,
  IconChevronRight,
  IconPencil,
  IconPlus,
  IconRestore,
} from "@tabler/icons-react";
import type { OfficeDetail } from "@terhal/contracts";
import { DirectionalIcon } from "@/components/DirectionalIcon";
import { RequireStaff } from "@/components/session/RequireSession";
import { Avatar } from "@/components/staff/Avatar";
import { InfoList, InfoRow, SectionCard } from "@/components/staff/SectionCard";
import { SystemState } from "@/components/staff/SystemState";
import { DriverDrawer } from "@/components/staff/fleet/DriverDrawer";
import { OfficeDrawer } from "@/components/staff/fleet/OfficeDrawer";
import { VehicleDrawer } from "@/components/staff/fleet/VehicleDrawer";
import { VehicleThumb } from "@/components/staff/fleet/VehicleThumb";
import { Balance, Phone, displayPhone } from "@/components/staff/fleet/format";
import { useArchive } from "@/components/staff/fleet/useArchive";
import { useLocalName, useTripDates } from "@/components/staff/trips/format";
import { TripStatusBadge } from "@/components/staff/trips/TripStatusBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { call, isApiError, staffApi } from "@/lib/api";

export function OfficeDetailPage({ id }: { id: string }) {
  return <RequireStaff permission="fleet">{() => <Detail id={id} />}</RequireStaff>;
}

function Detail({ id }: { id: string }) {
  const office = useQuery({
    queryKey: ["staff", "office", id],
    queryFn: () => call(staffApi.offices[":id"].$get({ param: { id } })),
    retry: (count, error) => !(isApiError(error) && error.status === 404) && count < 1,
  });
  if (office.isPending) return <Skeleton className="h-64 w-full" />;
  if (office.isError) {
    return isApiError(office.error) && office.error.status === 404 ? (
      <SystemState kind="notFound" />
    ) : (
      <SystemState kind="error" onRetry={() => void office.refetch()} />
    );
  }
  return <Loaded office={office.data} />;
}

function Loaded({ office }: { office: OfficeDetail }) {
  const t = useTranslations("staff.fleet.office");
  const nav = useTranslations("staff.nav");
  const common = useTranslations("staff.common");
  const cars = useTranslations("staff.trips.car");
  const fields = useTranslations("common.fields");
  const name = useLocalName();
  const format = useFormatter();
  const { dateTime } = useTripDates();
  const archive = useArchive("offices");
  const [dialog, setDialog] = useState<"edit" | "driver" | "vehicle" | null>(null);
  const archived = office.archivedAt !== null;
  const opener = (which: "edit" | "driver" | "vehicle") => (open: boolean) =>
    setDialog(open ? which : null);

  return (
    <>
      <nav aria-label={t("breadcrumb")} className="flex items-center gap-2 text-xs">
        <Link href="/offices" className="text-primary hover:underline">
          {nav("offices")}
        </Link>
        <DirectionalIcon icon={IconChevronRight} className="size-3.5 text-muted" />
        <span className="text-muted">{office.name}</span>
      </nav>

      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-foreground">{office.name}</h1>
            {archived && <Badge tone="neutral">{t("archived")}</Badge>}
          </div>
          <p className="text-base text-muted">
            {[
              office.location && name(office.location),
              t("since", {
                date: format.dateTime(new Date(office.createdAt), {
                  month: "short",
                  year: "numeric",
                }),
              }),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void archive(office.id, archived)}>
            {archived ? (
              <IconRestore aria-hidden className="size-5" stroke={1.75} />
            ) : (
              <IconArchive aria-hidden className="size-5" stroke={1.75} />
            )}
            {archived ? common("restore") : common("archive")}
          </Button>
          <Button onClick={() => setDialog("edit")}>
            <IconPencil aria-hidden className="size-5" stroke={1.75} />
            {common("edit")}
          </Button>
        </div>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <SectionCard title={t("liveTrips")}>
            {office.trips.length === 0 ? (
              <p className="text-sm text-muted">{t("noTrips")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {office.trips.map((trip) => (
                  <li key={trip.id}>
                    <Link
                      href={`/trips/${trip.id}`}
                      className="flex items-center gap-4 py-3 hover:bg-surface-muted/50"
                    >
                      <span className="w-28 shrink-0 text-sm font-medium text-primary" dir="ltr">
                        {trip.code}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm text-foreground">
                          {trip.pickup} → {trip.dropoff}
                        </span>
                        <span className="text-xs text-muted">
                          {dateTime(trip.pickupDate)} ·{" "}
                          {trip.driver
                            ? `${trip.driver.firstName} ${trip.driver.lastName}`
                            : t("noDriver")}
                        </span>
                      </span>
                      <TripStatusBadge status={trip.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title={t("drivers")}
            aside={
              <Button variant="ghost" size="sm" onClick={() => setDialog("driver")}>
                <IconPlus aria-hidden className="size-4" stroke={1.75} />
                {t("addDriver")}
              </Button>
            }
          >
            {office.drivers.length === 0 ? (
              <p className="text-sm text-muted">{t("noDrivers")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {office.drivers.map((driver) => (
                  <li key={driver.id}>
                    <Link
                      href={`/drivers/${driver.id}`}
                      className="flex items-center gap-3 py-3 hover:bg-surface-muted/50"
                    >
                      <Avatar firstName={driver.firstName} lastName={driver.lastName} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-foreground">
                          {driver.firstName} {driver.lastName}
                        </span>
                        <span className="text-xs text-muted" dir="ltr">
                          {displayPhone(driver.phone)}
                        </span>
                      </span>
                      <Balance amountOwed={driver.amountOwed} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title={t("vehicles")}
            aside={
              <Button variant="ghost" size="sm" onClick={() => setDialog("vehicle")}>
                <IconPlus aria-hidden className="size-4" stroke={1.75} />
                {t("addVehicle")}
              </Button>
            }
          >
            {office.vehicles.length === 0 ? (
              <p className="text-sm text-muted">{t("noVehicles")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {office.vehicles.map((vehicle) => (
                  <li key={vehicle.id}>
                    <Link
                      href={`/vehicles/${vehicle.id}`}
                      className="flex items-center gap-3 py-3 hover:bg-surface-muted/50"
                    >
                      <VehicleThumb vehicle={vehicle} className="size-8" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-foreground">
                          {vehicle.make} {vehicle.model} {vehicle.year}
                        </span>
                        <span className="text-xs text-muted">
                          <span dir="ltr">{vehicle.plateNumber}</span> · {vehicle.color}
                        </span>
                      </span>
                      <Badge tone="neutral">{cars(vehicle.body)}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>

        <div className="flex flex-col gap-5">
          <SectionCard title={t("contactTitle")}>
            <InfoList>
              <InfoRow label={fields("contact")}>{office.contact}</InfoRow>
              <InfoRow label={fields("phone")}>
                <Phone phone={office.phone} />
              </InfoRow>
              <InfoRow label={fields("email")}>
                {office.email ? (
                  <a href={`mailto:${office.email}`} dir="ltr" className="hover:underline">
                    {office.email}
                  </a>
                ) : (
                  "—"
                )}
              </InfoRow>
              <InfoRow label={fields("address")}>{office.address}</InfoRow>
              <InfoRow label={fields("area")}>
                {office.location ? name(office.location) : "—"}
              </InfoRow>
            </InfoList>
          </SectionCard>
          {office.notes && (
            <SectionCard title={t("notes")}>
              <p className="text-sm whitespace-pre-line text-foreground">{office.notes}</p>
            </SectionCard>
          )}
        </div>
      </div>

      <OfficeDrawer office={office} open={dialog === "edit"} onOpenChange={opener("edit")} />
      <DriverDrawer
        officeId={office.id}
        open={dialog === "driver"}
        onOpenChange={opener("driver")}
      />
      <VehicleDrawer
        officeId={office.id}
        open={dialog === "vehicle"}
        onOpenChange={opener("vehicle")}
      />
    </>
  );
}
