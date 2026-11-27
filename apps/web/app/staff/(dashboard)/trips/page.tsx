import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TripsList } from "./TripsList";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.nav");
  return { title: t("trips") };
}

// The filters live in the URL (?status=, ?q=), so the top bar's search lands here and a filtered list can be shared.
export default function TripsPage() {
  return (
    <Suspense>
      <TripsList />
    </Suspense>
  );
}
