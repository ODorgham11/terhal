import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CustomersList } from "./CustomersList";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.nav");
  return { title: t("customers") };
}

export default function Page() {
  return <CustomersList />;
}
