import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SystemState } from "@/components/staff/SystemState";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.system.notFound");
  return { title: t("title") };
}

// Any dashboard address that isn't a page: the 404 inside the dashboard's frame.
export default function Missing() {
  return <SystemState kind="notFound" />;
}
