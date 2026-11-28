import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DriverLedgerPage } from "./DriverLedger";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.nav");
  return { title: t("drivers") };
}

export default async function Page({ params }: PageProps<"/staff/drivers/[id]/ledger">) {
  const { id } = await params;
  return <DriverLedgerPage id={id} />;
}
