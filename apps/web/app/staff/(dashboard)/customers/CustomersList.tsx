"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
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
  const router = useRouter();
  const customers = useCursorList(
    ["staff", "customers", "list"],
    { q: "", status: "" as Status | "" },
    (query) => call(staffApi.customers.$get({ query })),
  );
  const { filters, setFilter, rows, result } = customers;

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
      <div className="flex flex-wrap gap-3">
        <SearchBox
          initial={filters.q}
          onSearch={(q) => setFilter("q", q)}
          placeholder={t("search")}
        />
        <Select
          aria-label={t("status")}
          value={filters.status}
          onChange={(event) => setFilter("status", event.target.value as Status | "")}
          className="w-44"
        >
          <option value="">{t("allStatuses")}</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {t(`statuses.${status}`)}
            </option>
          ))}
        </Select>
      </div>
      <Table>
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
            <TableLoading columns={COLUMNS} />
          ) : result.isError ? (
            <TableEmpty columns={COLUMNS} title={errorMessage(result.error)} />
          ) : rows.length === 0 ? (
            <TableEmpty columns={COLUMNS} title={t("empty")} description={t("emptyHint")} />
          ) : (
            rows.map((customer) => (
              <CustomerRow
                key={customer.id}
                customer={customer}
                onOpen={() => router.push(`/customers/${customer.id}`)}
              />
            ))
          )}
        </TableBody>
      </Table>
      <ListPagination list={customers} />
    </>
  );
}

function CustomerRow({ customer, onOpen }: { customer: CustomerDetail; onOpen: () => void }) {
  const format = useFormatter();
  const { day, price } = useTripDates();
  const faded = customer.status === "SUSPENDED" || customer.status === "DELETED";

  return (
    <TableRow
      className={cn("cursor-pointer hover:bg-surface-muted/50", faded && "opacity-70")}
      onClick={onOpen}
    >
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar firstName={customer.firstName} lastName={customer.lastName} />
          <div className="flex min-w-0 flex-col">
            <Link
              href={`/customers/${customer.id}`}
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
      <TableCell className="text-sm whitespace-nowrap" dir="ltr">
        {displayPhone(customer.phone)}
      </TableCell>
      <TableCell className="text-sm tabular-nums">{customer.tripCount}</TableCell>
      <TableCell className="text-sm font-medium whitespace-nowrap tabular-nums">
        {Number(customer.totalSpent) > 0 ? price(customer.totalSpent) : "—"}
      </TableCell>
      <TableCell className="text-sm text-muted">
        {customer.lastTripAt ? day(customer.lastTripAt) : "—"}
      </TableCell>
      <TableCell className="text-sm text-muted">
        {format.dateTime(new Date(customer.createdAt), { month: "short", year: "numeric" })}
      </TableCell>
      <TableCell>
        <CustomerStatusBadge status={customer.status} />
      </TableCell>
    </TableRow>
  );
}
