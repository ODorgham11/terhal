import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SignInForm } from "./SignInForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.auth.signIn");
  return { title: t("title") };
}

export default function SignInPage() {
  return <SignInForm />;
}
