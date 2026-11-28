import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.auth.forgotPassword");
  return { title: t("title") };
}

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
