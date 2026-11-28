import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Overview } from "./Overview";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.nav");
  return { title: t("overview") };
}

export default function OverviewPage() {
  return <Overview />;
}
