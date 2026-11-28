import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NotificationsPage } from "./NotificationsPage";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.nav");
  return { title: t("notifications") };
}

export default function Page() {
  return <NotificationsPage />;
}
