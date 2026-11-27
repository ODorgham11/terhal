"use client";

import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { IconChevronRight, IconPlus } from "@tabler/icons-react";
import type { CustomerDetail } from "@terhal/contracts";
import { DirectionalIcon } from "@/components/DirectionalIcon";
import { RequireStaff } from "@/components/session/RequireSession";
import { ListPagination, useCursorList } from "@/components/staff/CursorList";
import { InfoList, InfoRow, SectionCard } from "@/components/staff/SectionCard";
import { SystemState } from "@/components/staff/SystemState";
import { CustomerStatusBadge } from "@/components/staff/customers/CustomerStatusBadge";
import { Phone } from "@/components/staff/fleet/format";
import { useTripDates } from "@/components/staff/trips/format";
import { TripStatusBadge } from "@/components/staff/trips/TripStatusBadge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
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
import { call, isApiError, staffApi, useErrorMessage } from "@/lib/api";

export function CustomerDetailPage({ id }: { id: string }) {
  return (
    <RequireStaff permission="customers">
      {(staff) => <Detail id={id} canBook={staff.permissions.includes("trips")} />}
    </RequireStaff>
  );
}

function Detail({ id, canBook }: { id: string; canBook: boolean }) {
  const customer = useQuery({
    queryKey: ["staff", "customer", id],
    queryFn: () => call(staffApi.customers[":id"].$get({ param: { id } })),
    retry: (count, error) => !(isApiError(error) && error.status === 404) && count < 1,
  });
  if (customer.isPending) return <Skeleton className="h-64 w-full" />;
  if (customer.isError) {
    return isApiError(customer.error) && customer.error.status === 404 ? (
      <SystemState kind="notFound" />
    ) : (
      <SystemState kind="error" onRetry={() => void customer.refetch()} />
    );
  }
  return <Loaded customer={customer.data} canBook={canBook} />;
}

function Loaded({ customer, canBook }: { customer: CustomerDetail; canBook: boolean }) {
  const t = useTranslations("staff.customers.detail");
  const nav = useTranslations("staff.nav");
  const fields = useTranslations("common.fields");
  const common = useTranslations("staff.common");
  const format = useFormatter();
  const { price } = useTripDates();
  const name = `${customer.firstName} ${customer.lastName}`;
  const bookable = canBook && customer.status === "ACTIVE";

  const stats = [
    { label: t("trips"), value: customer.tripCount },
    { label: t("completed"), value: customer.completedCount },
    { label: t("cancelled"), value: customer.cancelledCount },
    { label: t("spent"), value: price(customer.totalSpent) },
  ];

  return (
    <>
      <nav aria-label={t("breadcrumb")} className="flex items-center gap-2 text-xs">
        <Link href="/customers" className="text-primary hover:underline">
          {nav("customers")}
        </Link>
        <DirectionalIcon icon={IconChevronRight} className="size-3.5 text-muted" />
        <span className="text-muted">{name}</span>
      </nav>

      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-foreground">{name}</h1>
            <CustomerStatusBadge status={customer.status} />
          </div>
          <p className="text-base text-muted">
            {t("since", {
              date: format.dateTime(new Date(customer.createdAt), {
                month: "short",
                year: "numeric",
              }),
            })}
          </p>
        </div>
        {bookable && (
          <Button asChild>
            <Link href={`/trips/new?customer=${customer.id}`}>
              <IconPlus aria-hidden className="size-5" stroke={1.75} />
              {t("book", { name: customer.firstName })}
            </Link>
          </Button>
        )}
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4"
              >
                <dt className="text-sm text-muted">{stat.label}</dt>
                <dd className="text-xl font-semibold text-foreground tabular-nums">{stat.value}</dd>
              </div>
            ))}
          </dl>
          <CustomerTrips customerId={customer.id} />
        </div>

        <div className="flex flex-col gap-5">
          <SectionCard title={t("contact")}>
            <InfoList>
              <InfoRow label={fields("email")}>
                <a href={`mailto:${customer.email}`} dir="ltr" className="hover:underline">
                  {customer.email}
                </a>
              </InfoRow>
              <InfoRow label={fields("phone")}>
                <Phone phone={customer.phone} />
              </InfoRow>
              <InfoRow label={t("language")}>{t(`languages.${customer.locale}`)}</InfoRow>
              <InfoRow label={t("verified")}>
                {customer.verifiedAt ? common("yes") : common("no")}
              </InfoRow>
            </InfoList>
          </SectionCard>
          <SectionCard title={t("account")}>
            <p className="text-xs text-muted">{t("accountHint")}</p>
          </SectionCard>
        </div>
      </div>
    </>
  );
}

const COLUMNS = 5;

function CustomerTrips({ customerId }: { customerId: string }) {
  const t = useTranslations("staff.customers.detail");
  const errorMessage = useErrorMessage();
  const { dateTime, price } = useTripDates();
  // Arrows aren't mirrored in right-to-left text, so Arabic gets the one pointing left.
  const arrow = useLocale() === "ar" ? "←" : "→";
  const trips = useCursorList(
    ["staff", "customer", customerId, "trips"],
    {},
    (query) => call(staffApi.customers[":id"].trips.$get({ param: { id: customerId }, query })),
    10,
  );
  const { rows, result } = trips;

  return (
    <div className="flex flex-col gap-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.trip")}</TableHead>
            <TableHead>{t("columns.route")}</TableHead>
            <TableHead>{t("columns.pickup")}</TableHead>
            <TableHead>{t("columns.price")}</TableHead>
            <TableHead>{t("columns.status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.isPending ? (
            <TableLoading columns={COLUMNS} />
          ) : result.isError ? (
            <TableEmpty columns={COLUMNS} title={errorMessage(result.error)} />
          ) : rows.length === 0 ? (
            <TableEmpty columns={COLUMNS} title={t("noTrips")} />
          ) : (
            rows.map((trip) => (
              <TableRow key={trip.id}>
                <TableCell>
                  <Link
                    href={`/trips/${trip.id}`}
                    dir="ltr"
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    {trip.code}
                  </Link>
                </TableCell>
                <TableCell className="max-w-64 truncate text-sm">
                  {trip.pickup} {arrow} {trip.dropoff}
                </TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  {dateTime(trip.pickupDate)}
                </TableCell>
                <TableCell className="text-sm whitespace-nowrap tabular-nums">
                  {trip.totalPrice ? price(trip.totalPrice) : t("priceRequested")}
                </TableCell>
                <TableCell>
                  <TripStatusBadge status={trip.status} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <ListPagination list={trips} />
    </div>
  );
}
