"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { motion } from "motion/react";
import { IconDownload } from "@tabler/icons-react";
import type { CustomerDetail, Staff } from "@terhal/contracts";
import { RequireStaff } from "@/components/session/RequireSession";
import { Avatar } from "@/components/staff/Avatar";
import { ListPagination, useCursorList } from "@/components/staff/CursorList";
import { SearchBox } from "@/components/staff/SearchBox";
import { CustomerStatusBadge } from "@/components/staff/customers/CustomerStatusBadge";
import { displayPhone } from "@/components/staff/fleet/format";
import { useTripDates } from "@/components/staff/trips/format";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { AutoHeight, fade } from "@/components/ui/Motion";
import { Skeleton, SkeletonLines } from "@/components/ui/Skeleton";
import {
  MotionTableRow,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { call, endpoint, staffApi, useErrorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

const COLUMNS = 7;
const statuses = ["ACTIVE", "UNVERIFIED", "SUSPENDED", "DELETED"] as const;
type Status = (typeof statuses)[number];

export function CustomersList() {
  return (
    <RequireStaff permission="customers">{(staff) => <Customers staff={staff} />}</RequireStaff>
  );
}

function Customers({ staff }: { staff: Staff }) {
  const t = useTranslations("staff.customers");
  const list = useTranslations("staff.list");
  const errorMessage = useErrorMessage();
  const customers = useCursorList(
    ["staff", "customers", "list"],
    { q: "", status: "" as Status | "" },
    (query) => call(staffApi.customers.$get({ query })),
  );
  const { filters, setFilter, rows, result } = customers;
  // Rows from the last filter stay up, dimmed, until the new ones arrive, so the table never empties out.
  const stale = result.isPlaceholderData;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          // The export is an analytics one: only staff who can see analytics get it.
          staff.permissions.includes("analytics") && (
            <Button asChild variant="secondary">
              <a href={`${endpoint}/v1/staff/exports/customers.csv`} download>
                <IconDownload aria-hidden className="size-5" stroke={1.75} />
                {list("exportCsv")}
              </a>
            </Button>
          )
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchBox
          initial={filters.q}
          onSearch={(q) => setFilter("q", q)}
          placeholder={t("search")}
        />
        <Select
          aria-label={t("status")}
          value={filters.status}
          onChange={(event) => setFilter("status", event.target.value as Status | "")}
          className="sm:w-44"
        >
          <option value="">{t("allStatuses")}</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {t(`statuses.${status}`)}
            </option>
          ))}
        </Select>
      </div>
      {/* Phones: one card per customer. */}
      <AutoHeight className="md:hidden">
        <ul
          aria-busy={result.isFetching || undefined}
          className={cn("flex flex-col gap-3 transition-opacity", stale && "opacity-60")}
        >
          {result.isPending ? (
            <CustomerCardsLoading />
          ) : result.isError ? (
            <motion.li {...fade} className="py-10 text-center text-sm text-danger">
              {errorMessage(result.error)}
            </motion.li>
          ) : rows.length === 0 ? (
            <motion.li {...fade} className="flex flex-col items-center gap-1.5 py-10 text-center">
              <span className="text-base font-semibold text-foreground">{t("empty")}</span>
              <span className="text-[0.8125rem] text-muted">{t("emptyHint")}</span>
            </motion.li>
          ) : (
            rows.map((customer) => <CustomerCard key={customer.id} customer={customer} />)
          )}
        </ul>
      </AutoHeight>

      <AutoHeight className="hidden md:block">
        <Table
          aria-busy={result.isFetching || undefined}
          className={cn("transition-opacity", stale && "opacity-60")}
        >
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.customer")}</TableHead>
              <TableHead>{t("columns.phone")}</TableHead>
              <TableHead>{t("columns.trips")}</TableHead>
              <TableHead>{t("columns.spent")}</TableHead>
              <TableHead>{t("columns.lastTrip")}</TableHead>
              <TableHead>{t("columns.joined")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.isPending ? (
              <CustomerRowsLoading />
            ) : result.isError ? (
              <TableEmpty columns={COLUMNS} title={errorMessage(result.error)} />
            ) : rows.length === 0 ? (
              <TableEmpty columns={COLUMNS} title={t("empty")} description={t("emptyHint")} />
            ) : (
              rows.map((customer) => <CustomerRow key={customer.id} customer={customer} />)
            )}
          </TableBody>
        </Table>
      </AutoHeight>
      <ListPagination list={customers} />
    </>
  );
}

// Suspended and deleted customers sit back a little.
const faded = (customer: CustomerDetail) =>
  customer.status === "SUSPENDED" || customer.status === "DELETED";

function CustomerRow({ customer }: { customer: CustomerDetail }) {
  const router = useRouter();
  const list = useTranslations("staff.list");
  const format = useFormatter();
  const { day, price } = useTripDates();
  const href = `/customers/${customer.id}`;

  return (
    <MotionTableRow
      {...fade}
      className={cn("cursor-pointer hover:bg-hover", faded(customer) && "opacity-70")}
      onClick={() => router.push(href)}
    >
      <TableCell>
        <div className="flex items-center gap-2.5">
          <Avatar firstName={customer.firstName} lastName={customer.lastName} />
          <div className="flex min-w-0 flex-col">
            <Link
              href={href}
              onClick={(event) => event.stopPropagation()}
              className="truncate text-sm font-medium text-foreground hover:underline"
            >
              {customer.firstName} {customer.lastName}
            </Link>
            <span className="truncate text-xs text-muted" dir="ltr">
              {customer.email}
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap" dir="ltr">
        {displayPhone(customer.phone)}
      </TableCell>
      <TableCell className="tabular-nums">{customer.tripCount}</TableCell>
      <TableCell className="font-medium whitespace-nowrap tabular-nums">
        {Number(customer.totalSpent) > 0 ? price(customer.totalSpent) : list("none")}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted">
        {customer.lastTripAt ? day(customer.lastTripAt) : list("none")}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted">
        {format.dateTime(new Date(customer.createdAt), { month: "short", year: "numeric" })}
      </TableCell>
      <TableCell>
        <CustomerStatusBadge status={customer.status} />
      </TableCell>
    </MotionTableRow>
  );
}

function CustomerCard({ customer }: { customer: CustomerDetail }) {
  const t = useTranslations("staff.customers");
  const { price } = useTripDates();
  return (
    <motion.li {...fade} className={cn(faded(customer) && "opacity-70")}>
      <Link
        href={`/customers/${customer.id}`}
        className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-hover"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar firstName={customer.firstName} lastName={customer.lastName} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-foreground">
                {customer.firstName} {customer.lastName}
              </span>
              <span className="text-xs text-muted" dir="ltr">
                {displayPhone(customer.phone)}
              </span>
            </div>
          </div>
          <CustomerStatusBadge status={customer.status} />
        </div>
        <div className="flex items-end justify-between gap-3 border-t border-border pt-3 text-[0.8125rem]">
          <span className="text-muted">
            {t("columns.trips")}{" "}
            <span className="font-medium text-foreground tabular-nums">{customer.tripCount}</span>
          </span>
          {Number(customer.totalSpent) > 0 && (
            <span className="font-medium text-foreground tabular-nums">
              {price(customer.totalSpent)}
            </span>
          )}
        </div>
      </Link>
    </motion.li>
  );
}

// The first page loading: rows shaped like the customers they stand in for, so nothing moves when they arrive.
function CustomerRowsLoading() {
  const t = useTranslations("common.ui");
  return (
    <>
      {Array.from({ length: 6 }, (_, row) => (
        <motion.tr
          key={row}
          {...fade}
          className="border-b border-border"
          aria-hidden={row > 0 || undefined}
        >
          <TableCell>
            {row === 0 && <span className="sr-only">{t("loading")}</span>}
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <SkeletonLines first={row % 2 ? "w-32" : "w-28"} second="w-40" />
            </div>
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-28" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-6" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-20" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-20" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-16" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-5.5 w-18 rounded-full" />
          </TableCell>
        </motion.tr>
      ))}
    </>
  );
}

function CustomerCardsLoading() {
  return (
    <>
      {[0, 1, 2].map((card) => (
        <motion.li
          key={card}
          {...fade}
          aria-hidden
          className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-8 rounded-full" />
              <SkeletonLines first="w-32" second="w-24" />
            </div>
            <Skeleton className="h-5.5 w-18 rounded-full" />
          </div>
          <div className="flex items-end justify-between border-t border-border pt-3">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-3.5 w-20" />
          </div>
        </motion.li>
      ))}
    </>
  );
}
