import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LocationsPage } from "./LocationsPage";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.nav");
  return { title: t("locations") };
}

export default function Page() {
  return <LocationsPage />;
}
