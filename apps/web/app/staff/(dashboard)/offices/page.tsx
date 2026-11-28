import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { OfficesList } from "./OfficesList";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.nav");
  return { title: t("offices") };
}

export default function Page() {
  return <OfficesList />;
}
