"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { call, endpoint, staffApi, useErrorMessage } from "@/lib/api";

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
        <Select
          aria-label={common("office")}
          value={filters.officeId}
          onChange={(event) => setFilter("officeId", event.target.value)}
          className="sm:w-44"
        >
          <option value="">{common("allOffices")}</option>
          {offices.data?.data.map((office) => (
            <option key={office.id} value={office.id}>
              {office.name}
            </option>
          ))}
        </Select>
        <Checkbox
          className="sm:ms-auto"
          label={t("licenceExpiring")}
          checked={filters.licenseExpiring === "true"}
          onChange={(event) => setFilter("licenseExpiring", event.target.checked ? "true" : "")}
        />
      </div>

      <Table>
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
            <TableLoading columns={COLUMNS} />
          ) : result.isError ? (
            <TableEmpty columns={COLUMNS} title={errorMessage(result.error)} />
          ) : rows.length === 0 ? (
            <TableEmpty columns={COLUMNS} title={t("empty")} description={t("emptyHint")} />
          ) : (
            rows.map((driver) => <DriverRow key={driver.id} driver={driver} />)
          )}
        </TableBody>
      </Table>
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
    <TableRow
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
        <Balance amountOwed={driver.amountOwed} />
      </TableCell>
      <TableCell className="w-11 px-2" onClick={(event) => event.stopPropagation()}>
        <DriverMenu driver={driver} />
      </TableCell>
    </TableRow>
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
