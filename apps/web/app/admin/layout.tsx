import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AdminProviders } from "@/components/providers/HostProviders";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");
  return { title: { default: t("title"), template: `%s · ${t("title")}` } };
}

// admin.terhal.co (proxy.ts rewrites it here). The signed-in frame is in (panel)/layout.tsx.
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <AdminProviders>{children}</AdminProviders>;
}
