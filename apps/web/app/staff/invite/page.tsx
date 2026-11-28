import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AcceptInvitation } from "./AcceptInvitation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.auth.invite");
  return { title: t("title") };
}

// Where the emailed invitation lands: /invite?token=…
export default function InvitePage() {
  return <AcceptInvitation />;
}
