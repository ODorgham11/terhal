import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { StaffProviders } from "@/components/providers/HostProviders";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff");
  return { title: { default: t("title"), template: `%s · ${t("title")}` } };
}

// dashboard.terhal.co (proxy.ts rewrites it here). The signed-in frame is in (dashboard)/layout.tsx.
export default function StaffLayout({ children }: LayoutProps<"/staff">) {
  return <StaffProviders>{children}</StaffProviders>;
}
