import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SiteProviders } from "@/components/providers/HostProviders";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("site");
  return { title: { default: t("title"), template: `%s · ${t("title")}` } };
}

// terhal.co, the customer site (proxy.ts rewrites it here). Each part brings its own frame: (home) the site's, report/
// the driver's.
export default function SiteLayout({ children }: LayoutProps<"/site">) {
  return <SiteProviders>{children}</SiteProviders>;
}
