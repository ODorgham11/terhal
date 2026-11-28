import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AdminSignInForm } from "./AdminSignInForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.auth.signIn");
  return { title: t("title") };
}

export default function Page() {
  return <AdminSignInForm />;
}
