"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  IconArchive,
  IconDotsVertical,
  IconDownload,
  IconEye,
  IconPencil,
  IconPlus,
  IconRestore,
} from "@tabler/icons-react";
import type { Driver } from "@terhal/contracts";
import { RequireStaff } from "@/components/session/RequireSession";
import { Avatar } from "@/components/staff/Avatar";
import { ListPagination, useCursorList } from "@/components/staff/CursorList";
import { SearchBox } from "@/components/staff/SearchBox";
import { DriverDrawer } from "@/components/staff/fleet/DriverDrawer";
import { useArchive } from "@/components/staff/fleet/useArchive";
import { Balance, KindBadge, Licence, displayPhone } from "@/components/staff/fleet/format";
import { officesQuery } from "@/components/staff/queries";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { AutoHeight, fade } from "@/components/ui/Motion";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { call, endpoint, staffApi, useErrorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

const COLUMNS = 6;

type Flag = "true" | "false";

export function DriversList() {
  return <RequireStaff permission="fleet">{() => <Drivers />}</RequireStaff>;
}

function Drivers() {
  const t = useTranslations("staff.fleet.drivers");
  const list = useTranslations("staff.list");
  const common = useTranslations("staff.common");
  const kinds = useTranslations("staff.fleet.kinds");
  const errorMessage = useErrorMessage();
  const [adding, setAdding] = useState(false);
  const offices = useQuery(officesQuery);
  const drivers = useCursorList(
    ["staff", "drivers"],
    {
      archived: "false" as Flag,
      q: "",
      external: "" as Flag | "",
      officeId: "",
      licenseExpiring: "" as Flag | "",
    },
    (query) => call(staffApi.drivers.$get({ query })),
  );
  const { filters, setFilter, rows, result } = drivers;
  // Rows from the last filter stay up, dimmed, until the new ones arrive, so the table never empties out.
  const stale = result.isPlaceholderData;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Button asChild variant="secondary">
              <a href={`${endpoint}/v1/staff/exports/drivers.csv`} download>
                <IconDownload aria-hidden className="size-5" stroke={1.75} />
                {list("exportCsv")}
              </a>
            </Button>
            <Button onClick={() => setAdding(true)}>
              <IconPlus aria-hidden className="size-5" stroke={1.75} />
              {t("add")}
            </Button>
          </>
        }
      />

      <Tabs
        value={filters.archived}
        onValueChange={(value) => setFilter("archived", value as Flag)}
      >
        <TabsList>
          <TabsTrigger value="false">{list("active")}</TabsTrigger>
          <TabsTrigger value="true">{list("archived")}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchBox
          initial={filters.q}
          onSearch={(q) => setFilter("q", q)}
          placeholder={t("search")}
        />
        <Select
          aria-label={t("type")}
          value={filters.external}
          onChange={(event) => setFilter("external", event.target.value as Flag | "")}
          className="sm:w-40"
        >
          <option value="">{t("allTypes")}</option>
          <option value="false">{kinds("internal")}</option>
          <option value="true">{t("externalOrOffice")}</option>
        </Select>
        {/* Held open while the offices load, so the row doesn't shift when they arrive; left out when there are none. */}
        {offices.data ? (
          offices.data.data.length > 0 && (
            <motion.div {...fade}>
              <Select
                aria-label={common("office")}
                value={filters.officeId}
                onChange={(event) => setFilter("officeId", event.target.value)}
                className="sm:w-44"
              >
                <option value="">{common("allOffices")}</option>
                {offices.data.data.map((office) => (
                  <option key={office.id} value={office.id}>
                    {office.name}
                  </option>
                ))}
              </Select>
            </motion.div>
          )
        ) : (
          <Skeleton className="h-10 w-full rounded-lg sm:w-44" />
        )}
        <Checkbox
          className="sm:ms-auto"
          label={t("licenceExpiring")}
          checked={filters.licenseExpiring === "true"}
          onChange={(event) => setFilter("licenseExpiring", event.target.checked ? "true" : "")}
        />
      </div>

      {/* Phones: one card per driver. */}
      <AutoHeight className="md:hidden">
        <ul
          aria-busy={result.isFetching || undefined}
          className={cn("flex flex-col gap-3 transition-opacity", stale && "opacity-60")}
        >
          {result.isPending ? (
            <DriverCardsLoading />
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
            rows.map((driver) => <DriverCard key={driver.id} driver={driver} />)
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
              <TableHead>{t("columns.driver")}</TableHead>
              <TableHead>{t("columns.type")}</TableHead>
              <TableHead>{t("columns.office")}</TableHead>
              <TableHead>{t("columns.licence")}</TableHead>
              <TableHead>{t("columns.balance")}</TableHead>
              <TableHead>
                <span className="sr-only">{list("actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.isPending ? (
              <DriverRowsLoading />
            ) : result.isError ? (
              <TableEmpty columns={COLUMNS} title={errorMessage(result.error)} />
            ) : rows.length === 0 ? (
              <TableEmpty columns={COLUMNS} title={t("empty")} description={t("emptyHint")} />
            ) : (
              rows.map((driver) => <DriverRow key={driver.id} driver={driver} />)
            )}
          </TableBody>
        </Table>
      </AutoHeight>
      <ListPagination list={drivers} />

      <DriverDrawer open={adding} onOpenChange={setAdding} />
    </>
  );
}

function DriverRow({ driver }: { driver: Driver }) {
  const router = useRouter();
  const list = useTranslations("staff.list");
  const href = `/drivers/${driver.id}`;

  return (
    <MotionTableRow
      {...fade}
      className="cursor-pointer hover:bg-surface-muted/50"
      onClick={() => router.push(href)}
    >
      <TableCell>
        <div className="flex items-center gap-2.5">
          <Avatar firstName={driver.firstName} lastName={driver.lastName} />
          <div className="flex min-w-0 flex-col">
            <Link
              href={href}
              onClick={(event) => event.stopPropagation()}
              className="truncate text-sm font-medium text-foreground hover:underline"
            >
              {driver.firstName} {driver.lastName}
            </Link>
            <span className="text-xs text-muted" dir="ltr">
              {displayPhone(driver.phone)}
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <KindBadge item={driver} />
      </TableCell>
      <TableCell className="text-sm text-foreground">
        {driver.office?.name ?? list("none")}
      </TableCell>
      <TableCell>
        <Licence driver={driver} />
      </TableCell>
      <TableCell>
        <Balance amountOwed={driver.amountOwed} className="text-[0.8125rem]" />
      </TableCell>
      <TableCell className="w-11 px-2" onClick={(event) => event.stopPropagation()}>
        <DriverMenu driver={driver} />
      </TableCell>
    </MotionTableRow>
  );
}

function DriverCard({ driver }: { driver: Driver }) {
  return (
    <motion.li {...fade}>
      <Link
        href={`/drivers/${driver.id}`}
        className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-muted/50"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar firstName={driver.firstName} lastName={driver.lastName} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-foreground">
                {driver.firstName} {driver.lastName}
              </span>
              <span className="text-xs text-muted" dir="ltr">
                {displayPhone(driver.phone)}
              </span>
            </div>
          </div>
          <KindBadge item={driver} />
        </div>
        <div className="flex items-end justify-between gap-3 border-t border-border pt-3">
          <Licence driver={driver} />
          <div className="flex flex-col items-end">
            <Balance amountOwed={driver.amountOwed} className="text-[0.8125rem]" />
            {driver.office && <span className="text-xs text-muted">{driver.office.name}</span>}
          </div>
        </div>
      </Link>
    </motion.li>
  );
}

// The first page loading: rows shaped like the drivers they stand in for, so nothing moves when they arrive.
function DriverRowsLoading() {
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
              <SkeletonLines first={row % 2 ? "w-32" : "w-28"} second="w-24" />
            </div>
          </TableCell>
          <TableCell>
            <Skeleton className="h-5.5 w-20 rounded-full" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-24" />
          </TableCell>
          <TableCell>
            <SkeletonLines first="w-16" second="w-24" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-20" />
          </TableCell>
          <TableCell className="w-11 px-2">
            <Skeleton className="size-8 rounded-lg" />
          </TableCell>
        </motion.tr>
      ))}
    </>
  );
}

function DriverCardsLoading() {
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
            <Skeleton className="h-5.5 w-20 rounded-full" />
          </div>
          <div className="flex items-end justify-between border-t border-border pt-3">
            <SkeletonLines first="w-16" second="w-24" />
            <Skeleton className="h-3.5 w-20" />
          </div>
        </motion.li>
      ))}
    </>
  );
}

function DriverMenu({ driver }: { driver: Driver }) {
  const t = useTranslations("staff.fleet.drivers");
  const common = useTranslations("staff.common");
  const archive = useArchive("drivers");
  const [editing, setEditing] = useState(false);
  const archived = driver.archivedAt !== null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("menu", { name: `${driver.firstName} ${driver.lastName}` })}
          >
            <IconDotsVertical aria-hidden className="size-4.5" stroke={1.75} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem asChild>
            <Link href={`/drivers/${driver.id}`}>
              <IconEye aria-hidden className="size-4" stroke={1.75} />
              {t("open")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <IconPencil aria-hidden className="size-4" stroke={1.75} />
            {common("edit")}
          </DropdownMenuItem>
          <DropdownMenuItem
            destructive={!archived}
            onSelect={() => void archive(driver.id, archived)}
          >
            {archived ? (
              <IconRestore aria-hidden className="size-4" stroke={1.75} />
            ) : (
              <IconArchive aria-hidden className="size-4" stroke={1.75} />
            )}
            {archived ? common("restore") : common("archive")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DriverDrawer driver={driver} open={editing} onOpenChange={setEditing} />
    </>
  );
}
