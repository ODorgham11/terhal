import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccountPage } from "./AccountPage";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.nav");
  return { title: t("account") };
}

export default function Page() {
  return <AccountPage />;
}
