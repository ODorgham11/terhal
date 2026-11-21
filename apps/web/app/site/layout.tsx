import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { SiteProviders } from "@/components/providers/HostProviders";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("site");
  return { title: { default: t("title"), template: `%s · ${t("title")}` } };
}

// terhal.co, the customer site (proxy.ts rewrites it here).
export default async function SiteLayout({ children }: LayoutProps<"/site">) {
  const t = await getTranslations("site");

  return (
    <SiteProviders>
      <AppShell title={t("title")}>{children}</AppShell>
    </SiteProviders>
  );
}
