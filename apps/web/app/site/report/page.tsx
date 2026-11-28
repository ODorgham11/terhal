import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DriverReport } from "@/components/report/DriverReport";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("report");
  // A private link: never indexed, and no referrer carries it anywhere.
  return { title: t("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

// terhal.co/report#<token>: the link the office sends a driver for one trip.
export default function ReportPage() {
  return <DriverReport />;
}
