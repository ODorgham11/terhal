import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PricesList } from "./PricesList";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.nav");
  return { title: t("prices") };
}

export default function Page() {
  return <PricesList />;
}
