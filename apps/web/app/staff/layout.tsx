import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { StaffProviders } from "@/components/providers/HostProviders";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff");
  return { title: { default: t("title"), template: `%s · ${t("title")}` } };
}

// dashboard.terhal.co (proxy.ts rewrites it here).
export default async function StaffLayout({ children }: LayoutProps<"/staff">) {
  const t = await getTranslations("staff");

  return (
    <StaffProviders>
      <AppShell title={t("title")}>{children}</AppShell>
    </StaffProviders>
  );
}
