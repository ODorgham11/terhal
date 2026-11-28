"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { IconCash, IconChevronRight } from "@tabler/icons-react";
import type { Driver } from "@terhal/contracts";
import { DirectionalIcon } from "@/components/DirectionalIcon";
import { RequireStaff } from "@/components/session/RequireSession";
import { DetailLoading } from "@/components/staff/DetailLoading";
import { SystemState } from "@/components/staff/SystemState";
import { LedgerTable } from "@/components/staff/fleet/Ledger";
import { RecordPaymentDialog } from "@/components/staff/fleet/RecordPaymentDialog";
import { useBalance } from "@/components/staff/fleet/format";
import { useTripDates } from "@/components/staff/trips/format";
import { Button } from "@/components/ui/Button";
import { FadeText, fade } from "@/components/ui/Motion";
import { call, isApiError, staffApi } from "@/lib/api";
import { cn } from "@/lib/cn";

export function DriverLedgerPage({ id }: { id: string }) {
  return <RequireStaff permission="fleet">{() => <Ledger id={id} />}</RequireStaff>;
}

function Ledger({ id }: { id: string }) {
  const driver = useQuery({
    queryKey: ["staff", "driver", id],
    queryFn: () => call(staffApi.drivers[":id"].$get({ param: { id } })),
    retry: (count, error) => !(isApiError(error) && error.status === 404) && count < 1,
  });
  if (driver.isPending) {
    return <DetailLoading buttons={["w-40"]} badge={false} main={[]} side={[]} />;
  }
  if (driver.isError) {
    return isApiError(driver.error) && driver.error.status === 404 ? (
      <SystemState kind="notFound" />
    ) : (
      <SystemState kind="error" onRetry={() => void driver.refetch()} />
    );
  }
  return <Loaded driver={driver.data} />;
}

// Every entry on a driver's ledger, a page at a time; the driver's page shows the latest ten.
function Loaded({ driver }: { driver: Driver }) {
  const t = useTranslations("staff.fleet.driver");
  const nav = useTranslations("staff.nav");
  const { price } = useTripDates();
  const balance = useBalance()(driver.amountOwed);
  const [paying, setPaying] = useState(false);
  const name = `${driver.firstName} ${driver.lastName}`;
  const amount = Number(driver.amountOwed);

  return (
    <motion.div {...fade} className="flex flex-col gap-6">
      <nav aria-label={t("breadcrumb")} className="flex items-center gap-2 text-xs">
        <Link href="/drivers" className="text-primary hover:underline">
          {nav("drivers")}
        </Link>
        <DirectionalIcon icon={IconChevronRight} className="size-3.5 text-muted" />
        <Link href={`/drivers/${driver.id}`} className="text-primary hover:underline">
          {name}
        </Link>
        <DirectionalIcon icon={IconChevronRight} className="size-3.5 text-muted" />
        <span className="text-muted">{t("ledger.title")}</span>
      </nav>

      <header className="flex flex-col gap-x-12 gap-y-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold text-foreground">
            {t("ledger.pageTitle", { name: driver.firstName })}
          </h1>
          <p className="text-sm text-muted">
            {amount === 0
              ? t("balance.settled")
              : amount > 0
                ? t("balance.companyOwes", { name: driver.firstName })
                : t("balance.driverOwes", { name: driver.firstName })}{" "}
            {amount !== 0 && (
              <span className={cn("font-medium tabular-nums", balance.tone)}>
                <FadeText value={price(Math.abs(amount).toFixed(2))} />
              </span>
            )}
          </p>
        </div>
        <Button className="self-start lg:self-auto" onClick={() => setPaying(true)}>
          <IconCash aria-hidden className="size-5" stroke={1.75} />
          {t("recordPayment")}
        </Button>
      </header>

      <LedgerTable driverId={driver.id} pageSize={25} paginated />
      <p className="-mt-2 text-xs text-muted">{t("ledger.hint", { name: driver.firstName })}</p>

      <RecordPaymentDialog driver={driver} open={paying} onOpenChange={setPaying} />
    </motion.div>
  );
}
