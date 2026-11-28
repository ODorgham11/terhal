import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AdminInvitation } from "./AdminInvitation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.auth.invite");
  return { title: t("title") };
}

export default function Page() {
  return <AdminInvitation />;
}
