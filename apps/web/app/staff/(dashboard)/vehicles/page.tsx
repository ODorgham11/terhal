import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { VehiclesList } from "./VehiclesList";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.nav");
  return { title: t("vehicles") };
}

export default function Page() {
  return <VehiclesList />;
}
