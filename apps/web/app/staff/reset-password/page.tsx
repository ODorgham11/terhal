import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ResetPasswordForm } from "./ResetPasswordForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.auth.resetPassword");
  return { title: t("title") };
}

// Where the emailed reset link lands: /reset-password?token=…
export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
