import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { AdminProviders } from "@/components/providers/HostProviders";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");
  return { title: { default: t("title"), template: `%s · ${t("title")}` } };
}

// admin.terhal.co (proxy.ts rewrites it here).
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const t = await getTranslations("admin");

  return (
    <AdminProviders>
      <AppShell title={t("title")}>{children}</AppShell>
    </AdminProviders>
  );
}
