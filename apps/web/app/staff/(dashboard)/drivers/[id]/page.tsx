import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DriverDetailPage } from "./DriverDetail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.nav");
  return { title: t("drivers") };
}

export default async function Page({ params }: PageProps<"/staff/drivers/[id]">) {
  const { id } = await params;
  return <DriverDetailPage id={id} />;
}
