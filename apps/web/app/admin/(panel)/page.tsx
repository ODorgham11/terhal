import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { StaffPage } from "./StaffPage";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.staff");
  return { title: t("title") };
}

export default function Page() {
  return <StaffPage />;
}
