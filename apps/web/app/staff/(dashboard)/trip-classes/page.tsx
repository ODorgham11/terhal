import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TripClassesList } from "./TripClassesList";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.nav");
  return { title: t("tripClasses") };
}

export default function Page() {
  return <TripClassesList />;
}
