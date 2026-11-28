import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CustomerDetailPage } from "./CustomerDetail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.nav");
  return { title: t("customers") };
}

export default async function Page({ params }: PageProps<"/staff/customers/[id]">) {
  const { id } = await params;
  return <CustomerDetailPage id={id} />;
}
