import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";

// The customer site's pages, in its frame. The driver report (report/) has a frame of its own.
export default async function HomeLayout({ children }: LayoutProps<"/site">) {
  const t = await getTranslations("site");
  return <AppShell title={t("title")}>{children}</AppShell>;
}
