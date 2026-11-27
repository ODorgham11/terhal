import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NewTrip } from "./NewTrip";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.booking");
  return { title: t("title") };
}

export default async function Page({ searchParams }: PageProps<"/staff/trips/new">) {
  const { customer } = await searchParams;
  return <NewTrip customerId={typeof customer === "string" ? customer : undefined} />;
}
