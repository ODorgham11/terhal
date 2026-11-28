"use client";

import { useTranslations } from "next-intl";
import { IconAlertTriangle } from "@tabler/icons-react";
import type { Trip } from "@terhal/contracts";

// Who's driving: the driver and their car, a partner office, "Unassigned" while it still needs someone, or a dash.
export function TripAssignment({ trip }: { trip: Trip }) {
  const t = useTranslations("staff.trips.assignment");

  if (trip.office) {
    return (
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm text-foreground">{trip.office.name}</span>
        <span className="truncate text-xs text-muted">{t("partnerOffice")}</span>
      </div>
    );
  }
  if (trip.driver || trip.vehicle) {
    return (
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm text-foreground">
          {trip.driver ? `${trip.driver.firstName} ${trip.driver.lastName}` : t("noDriver")}
        </span>
        {trip.vehicle && (
          <span className="truncate text-xs text-muted">
            {trip.vehicle.make} {trip.vehicle.model} ·{" "}
            <span dir="ltr">{trip.vehicle.plateNumber}</span>
          </span>
        )}
      </div>
    );
  }
  if (trip.status === "PENDING" || trip.status === "CONFIRMED") {
    return (
      <span className="inline-flex items-center gap-2 text-xs font-medium text-warning">
        <IconAlertTriangle aria-hidden className="size-4" stroke={1.75} />
        {t("unassigned")}
      </span>
    );
  }
  return <span className="text-sm text-muted">—</span>;
}
