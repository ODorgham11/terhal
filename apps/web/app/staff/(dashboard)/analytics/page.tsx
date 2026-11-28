import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AnalyticsPage } from "./AnalyticsPage";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.nav");
  return { title: t("analytics") };
}

export default function Page() {
  return <AnalyticsPage />;
}
