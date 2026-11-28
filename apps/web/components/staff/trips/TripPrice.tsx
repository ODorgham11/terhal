"use client";

import { useTranslations } from "next-intl";
import type { Trip } from "@terhal/contracts";
import { useTripDates } from "./format";

// The trip's price, or where it stands while there isn't one yet.
export function TripPrice({ trip }: { trip: Trip }) {
  const t = useTranslations("staff.trips.price");
  const { price } = useTripDates();

  if (trip.totalPrice === null) {
    return <span className="text-xs font-medium text-accent">{t("needsPrice")}</span>;
  }
  return (
    <span className="flex flex-col">
      <span className="text-[0.8125rem] font-medium text-foreground tabular-nums">
        {price(trip.totalPrice)}
      </span>
      {trip.priceState === "PROPOSED" && (
        <span className="text-xs text-muted">{t("proposed")}</span>
      )}
    </span>
  );
}
