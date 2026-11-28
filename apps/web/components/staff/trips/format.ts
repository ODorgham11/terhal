"use client";

import { useCallback } from "react";
import { useFormatter, useLocale } from "next-intl";

type Named = { nameEn: string; nameAr: string };

// A place's or a class's name in the page's language.
export function useLocalName() {
  const locale = useLocale();
  return useCallback((named: Named) => (locale === "ar" ? named.nameAr : named.nameEn), [locale]);
}

// "Nasr City → Smouha". Arrows aren't mirrored in right-to-left text, so Arabic gets the one pointing left, toward
// where the line reads on to.
export function useRoute() {
  const name = useLocalName();
  const arrow = useLocale() === "ar" ? "←" : "→";
  return useCallback(
    (trip: { pickup: Named; dropoff: Named }) =>
      `${name(trip.pickup)} ${arrow} ${name(trip.dropoff)}`,
    [name, arrow],
  );
}

// Trip times, on Cairo time (the formatter's time zone, set in i18n/request.ts).
export function useTripDates() {
  const format = useFormatter();
  return {
    // Sat, Nov 28, 9:00 AM
    dateTime: (iso: string) =>
      format.dateTime(new Date(iso), {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    // Nov 28
    day: (iso: string) => format.dateTime(new Date(iso), { month: "short", day: "numeric" }),
    // 9:00 AM
    time: (iso: string) => format.dateTime(new Date(iso), { hour: "numeric", minute: "2-digit" }),
    // EGP 1,250
    price: (amount: string) =>
      format.number(Number(amount), {
        style: "currency",
        currency: "EGP",
        maximumFractionDigits: 0,
      }),
  };
}
