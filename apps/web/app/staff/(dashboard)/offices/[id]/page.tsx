import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { OfficeDetailPage } from "./OfficeDetail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.nav");
  return { title: t("offices") };
}

export default async function Page({ params }: PageProps<"/staff/offices/[id]">) {
  const { id } = await params;
  return <OfficeDetailPage id={id} />;
}
