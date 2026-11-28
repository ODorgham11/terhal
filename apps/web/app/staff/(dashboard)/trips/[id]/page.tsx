import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TripDetailPage } from "./TripDetail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.nav");
  return { title: t("trips") };
}

export default async function Page({ params }: PageProps<"/staff/trips/[id]">) {
  const { id } = await params;
  return <TripDetailPage id={id} />;
}
