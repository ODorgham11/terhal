"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { IconChevronRight, IconDownload, IconFileSpreadsheet } from "@tabler/icons-react";
import type { AnalyticsReport } from "@terhal/contracts";
import { DirectionalIcon } from "@/components/DirectionalIcon";
import { RequireStaff } from "@/components/session/RequireSession";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableLoading,
  TableRow,
} from "@/components/ui/Table";
import { toast } from "@/components/ui/Toast";
import { call, staffApi, useErrorMessage } from "@/lib/api";

export function ReportsPage() {
  return <RequireStaff permission="analytics">{() => <Reports />}</RequireStaff>;
}

const COLUMNS = 4;

function Reports() {
  const t = useTranslations("staff.analytics.reports");
  const nav = useTranslations("staff.nav");
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const reports = useQuery({
    queryKey: ["staff", "analytics", "reports"],
    queryFn: () => call(staffApi.analytics.reports.$get()),
  });
  const now = new Date();
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return (
    <>
      <nav aria-label={t("breadcrumb")} className="flex items-center gap-2 text-xs">
        <Link href="/analytics" className="text-primary hover:underline">
          {nav("analytics")}
        </Link>
        <DirectionalIcon icon={IconChevronRight} className="size-3.5 text-muted" />
        <span className="text-muted">{t("title")}</span>
      </nav>
      <PageHeader title={t("title")} description={t("description")} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("month")}</TableHead>
            <TableHead>{t("size")}</TableHead>
            <TableHead>{t("generated")}</TableHead>
            <TableHead>
              <span className="sr-only">{t("download")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reports.isPending ? (
            <TableLoading columns={COLUMNS} />
          ) : reports.isError ? (
            <TableEmpty columns={COLUMNS} title={errorMessage(reports.error)} />
          ) : reports.data.data.length === 0 ? (
            <TableEmpty columns={COLUMNS} title={t("empty")} description={t("emptyHint")} />
          ) : (
            reports.data.data.map((report) => (
              <ReportRow key={`${String(report.year)}-${String(report.month)}`} report={report} />
            ))
          )}
        </TableBody>
      </Table>
      <p className="text-xs text-muted">
        {t("next", {
          month: format.dateTime(now, { month: "long", year: "numeric" }),
          date: format.dateTime(nextMonthStart, { month: "short", day: "numeric" }),
        })}
      </p>
    </>
  );
}

function ReportRow({ report }: { report: AnalyticsReport }) {
  const t = useTranslations("staff.analytics.reports");
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const month = format.dateTime(new Date(report.year, report.month - 1, 1), {
    month: "long",
    year: "numeric",
  });

  // The link is signed and short-lived, so it's asked for at the moment of downloading.
  const download = async () => {
    setBusy(true);
    try {
      const link = await call(
        staffApi.analytics.reports[":year"][":month"].$get({
          param: { year: String(report.year), month: String(report.month) },
        }),
      );
      window.location.assign(link.url);
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <TableRow>
      <TableCell>
        <span className="flex items-center gap-2.5 text-sm font-medium text-foreground">
          <IconFileSpreadsheet aria-hidden className="size-5 text-success" stroke={1.75} />
          {month}
        </span>
      </TableCell>
      <TableCell className="text-sm text-muted tabular-nums">
        {format.number(report.size / 1024, { maximumFractionDigits: 0 })} {t("kb")}
      </TableCell>
      <TableCell className="text-sm text-muted">
        {format.dateTime(new Date(report.generatedAt), { dateStyle: "medium", timeStyle: "short" })}
      </TableCell>
      <TableCell className="text-end">
        <Button variant="secondary" size="sm" loading={busy} onClick={() => void download()}>
          <IconDownload aria-hidden className="size-4" stroke={1.75} />
          {t("download")}
        </Button>
      </TableCell>
    </TableRow>
  );
}
