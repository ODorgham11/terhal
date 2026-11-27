"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { call, staffApi, useErrorMessage } from "@/lib/api";
import { useRoute, useTripDates } from "../trips/format";
import { TripStatusBadge } from "../trips/TripStatusBadge";

type Filter = { driverId: string } | { vehicleId: string } | { officeId: string };

// The live trips ahead for a driver, a vehicle or an office, soonest first.
export function FleetTrips({ filter }: { filter: Filter }) {
  const t = useTranslations("staff.fleet");
  const errorMessage = useErrorMessage();
  const route = useRoute();
  const { dateTime } = useTripDates();
  // From the start of today, so a trip under way this morning still shows.
  const from = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const trips = useQuery({
    queryKey: ["staff", "trips", { ...filter, upcoming: true }],
    queryFn: () => call(staffApi.trips.$get({ query: { ...filter, from, limit: "50" } })),
  });

  if (trips.isPending) return <p className="text-sm text-muted">{t("loadingTrips")}</p>;
  if (trips.isError) return <p className="text-sm text-danger">{errorMessage(trips.error)}</p>;
  const upcoming = trips.data.data
    .filter((trip) => trip.status !== "CANCELLED" && trip.status !== "COMPLETED")
    .sort((a, b) => a.pickupDate.localeCompare(b.pickupDate))
    .slice(0, 8);
  if (upcoming.length === 0) return <p className="text-sm text-muted">{t("noUpcoming")}</p>;

  return (
    <ul className="flex flex-col divide-y divide-border">
      {upcoming.map((trip) => (
        <li key={trip.id}>
          <Link
            href={`/trips/${trip.id}`}
            className="flex items-center gap-4 py-3 hover:bg-surface-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <span className="w-28 shrink-0 text-sm font-medium text-primary" dir="ltr">
              {trip.code}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm text-foreground">{route(trip)}</span>
              <span className="text-xs text-muted">{dateTime(trip.pickupDate)}</span>
            </span>
            <TripStatusBadge status={trip.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
