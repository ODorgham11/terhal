import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DriversList } from "./DriversList";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.nav");
  return { title: t("drivers") };
}

export default function Page() {
  return <DriversList />;
}
