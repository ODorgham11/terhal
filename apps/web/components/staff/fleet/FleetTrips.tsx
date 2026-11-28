"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Swap, fade } from "@/components/ui/Motion";
import { Skeleton } from "@/components/ui/Skeleton";
import { call, staffApi, useErrorMessage } from "@/lib/api";
import { useRoute, useTripDates } from "../trips/format";
import { TripStatusBadge } from "../trips/TripStatusBadge";

type Filter = { driverId: string } | { vehicleId: string } | { officeId: string };

// The live trips ahead for a driver, a vehicle or an office, soonest first.
export function FleetTrips({ filter }: { filter: Filter }) {
  const t = useTranslations("staff.fleet");
  const errorMessage = useErrorMessage();
  // From the start of today, so a trip under way this morning still shows.
  const from = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const trips = useQuery({
    queryKey: ["staff", "trips", { ...filter, upcoming: true }],
    queryFn: () => listTrips({ ...filter, from, limit: "50" }),
  });

  const upcoming = (trips.data?.data ?? [])
    .filter((trip) => trip.status !== "CANCELLED" && trip.status !== "COMPLETED")
    .sort((a, b) => a.pickupDate.localeCompare(b.pickupDate))
    .slice(0, 8);
  const state = trips.isPending
    ? "loading"
    : trips.isError
      ? "error"
      : upcoming.length === 0
        ? "empty"
        : "trips";

  return (
    <Swap state={state}>
      {state === "loading" ? (
        <TripsLoading label={t("loadingTrips")} />
      ) : state === "error" ? (
        <p className="py-6 text-center text-sm text-danger">{errorMessage(trips.error)}</p>
      ) : state === "empty" ? (
        <p className="flex min-h-24 items-center justify-center text-center text-sm text-muted">
          {t("noUpcoming")}
        </p>
      ) : (
        <TripList trips={upcoming} />
      )}
    </Swap>
  );
}

type FleetTrip = Awaited<ReturnType<typeof listTrips>>["data"][number];
const listTrips = (query: Record<string, string>) => call(staffApi.trips.$get({ query }));

function TripList({ trips }: { trips: FleetTrip[] }) {
  const route = useRoute();
  const { dateTime } = useTripDates();
  return (
    <ul className="-mx-2 flex flex-col">
      {trips.map((trip) => (
        <motion.li key={trip.id} {...fade} className="border-b border-border last:border-0">
          <Link
            href={`/trips/${trip.id}`}
            className="my-1 flex items-center gap-4 rounded-lg px-2 py-2 transition-colors duration-200 hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
        </motion.li>
      ))}
    </ul>
  );
}

// Rows shaped like the trips they stand in for.
function TripsLoading({ label }: { label: string }) {
  return (
    <ul role="status" className="-mx-2 flex flex-col">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((row) => (
        <li
          key={row}
          aria-hidden
          className="my-1 flex items-center gap-4 border-b border-border px-2 py-2 last:border-0"
        >
          <Skeleton className="h-3.5 w-24 shrink-0" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className={row % 2 ? "h-3.5 w-40" : "h-3.5 w-52"} />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-5.5 w-24 rounded-full" />
        </li>
      ))}
    </ul>
  );
}
