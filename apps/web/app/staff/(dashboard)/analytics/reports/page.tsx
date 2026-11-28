import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ReportsPage } from "./ReportsPage";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.analytics.reports");
  return { title: t("title") };
}

export default function Page() {
  return <ReportsPage />;
}
