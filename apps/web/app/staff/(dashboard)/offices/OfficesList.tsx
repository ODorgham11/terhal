"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import {
  IconArchive,
  IconDotsVertical,
  IconEye,
  IconPencil,
  IconPlus,
  IconRestore,
} from "@tabler/icons-react";
import type { Office } from "@terhal/contracts";
import { RequireStaff } from "@/components/session/RequireSession";
import { ListPagination, useCursorList } from "@/components/staff/CursorList";
import { SearchBox } from "@/components/staff/SearchBox";
import { OfficeDrawer } from "@/components/staff/fleet/OfficeDrawer";
import { displayPhone } from "@/components/staff/fleet/format";
import { useArchive } from "@/components/staff/fleet/useArchive";
import { useLocalName } from "@/components/staff/trips/format";
import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { AutoHeight, fade } from "@/components/ui/Motion";
import { PageHeader } from "@/components/ui/PageHeader";
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
import { call, staffApi, useErrorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

const COLUMNS = 5;
type Flag = "true" | "false";

export function OfficesList() {
  return <RequireStaff permission="fleet">{() => <Offices />}</RequireStaff>;
}

function Offices() {
  const t = useTranslations("staff.fleet.offices");
  const list = useTranslations("staff.list");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const offices = useCursorList(
    ["staff", "offices", "list"],
    { archived: "false" as Flag, q: "" },
    (query) => call(staffApi.offices.$get({ query })),
  );
  const { filters, setFilter, rows, result } = offices;
  // Rows from the last filter stay up, dimmed, until the new ones arrive, so the table never empties out.
  const stale = result.isPlaceholderData;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button onClick={() => setAdding(true)}>
            <IconPlus aria-hidden className="size-5" stroke={1.75} />
            {t("add")}
          </Button>
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
      </div>

      {/* Phones: one card per office. */}
      <AutoHeight className="md:hidden">
        <ul
          aria-busy={result.isFetching || undefined}
          className={cn("flex flex-col gap-3 transition-opacity", stale && "opacity-60")}
        >
          {result.isPending ? (
            <OfficeCardsLoading />
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
            rows.map((office) => <OfficeCard key={office.id} office={office} />)
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
              <TableHead>{t("columns.office")}</TableHead>
              <TableHead>{t("columns.contact")}</TableHead>
              <TableHead>{t("columns.area")}</TableHead>
              <TableHead>{t("columns.address")}</TableHead>
              <TableHead>
                <span className="sr-only">{list("actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.isPending ? (
              <OfficeRowsLoading />
            ) : result.isError ? (
              <TableEmpty columns={COLUMNS} title={errorMessage(result.error)} />
            ) : rows.length === 0 ? (
              <TableEmpty columns={COLUMNS} title={t("empty")} description={t("emptyHint")} />
            ) : (
              rows.map((office) => <OfficeRow key={office.id} office={office} />)
            )}
          </TableBody>
        </Table>
      </AutoHeight>
      <ListPagination list={offices} />

      <OfficeDrawer
        open={adding}
        onOpenChange={setAdding}
        onSaved={(office) => router.push(`/offices/${office.id}`)}
      />
    </>
  );
}

function OfficeRow({ office }: { office: Office }) {
  const router = useRouter();
  const name = useLocalName();
  const list = useTranslations("staff.list");
  const href = `/offices/${office.id}`;

  return (
    <MotionTableRow
      {...fade}
      className="cursor-pointer hover:bg-hover"
      onClick={() => router.push(href)}
    >
      <TableCell>
        <Link
          href={href}
          onClick={(event) => event.stopPropagation()}
          className="text-sm font-medium text-foreground hover:underline"
        >
          {office.name}
        </Link>
      </TableCell>
      <TableCell>
        <div className="flex flex-col">
          <span className="text-sm text-foreground">{office.contact}</span>
          <span className="text-xs text-muted" dir="ltr">
            {displayPhone(office.phone)}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-foreground">
        {office.location ? name(office.location) : list("none")}
      </TableCell>
      <TableCell className="max-w-72 truncate text-muted">{office.address}</TableCell>
      <TableCell className="w-11 px-2" onClick={(event) => event.stopPropagation()}>
        <OfficeMenu office={office} />
      </TableCell>
    </MotionTableRow>
  );
}

function OfficeCard({ office }: { office: Office }) {
  const name = useLocalName();
  return (
    <motion.li {...fade}>
      <Link
        href={`/offices/${office.id}`}
        className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-hover"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-foreground">{office.name}</span>
          {office.location && (
            <span className="shrink-0 text-xs text-muted">{name(office.location)}</span>
          )}
        </div>
        <div className="flex items-end justify-between gap-3 border-t border-border pt-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-[0.8125rem] text-foreground">{office.contact}</span>
            <span className="text-xs text-muted" dir="ltr">
              {displayPhone(office.phone)}
            </span>
          </div>
          <span className="min-w-0 truncate text-end text-xs text-muted">{office.address}</span>
        </div>
      </Link>
    </motion.li>
  );
}

// The first page loading: rows shaped like the offices they stand in for, so nothing moves when they arrive.
function OfficeRowsLoading() {
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
            <Skeleton className={cn("h-3.5", row % 2 ? "w-36" : "w-28")} />
          </TableCell>
          <TableCell>
            <SkeletonLines first="w-28" second="w-24" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-20" />
          </TableCell>
          <TableCell>
            <Skeleton className={cn("h-3.5", row % 2 ? "w-48" : "w-56")} />
          </TableCell>
          <TableCell className="w-11 px-2">
            <Skeleton className="size-8 rounded-lg" />
          </TableCell>
        </motion.tr>
      ))}
    </>
  );
}

function OfficeCardsLoading() {
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
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3 w-16" />
          </div>
          <div className="flex items-end justify-between border-t border-border pt-3">
            <SkeletonLines first="w-28" second="w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        </motion.li>
      ))}
    </>
  );
}

function OfficeMenu({ office }: { office: Office }) {
  const t = useTranslations("staff.fleet.offices");
  const common = useTranslations("staff.common");
  const archive = useArchive("offices");
  const [editing, setEditing] = useState(false);
  const archived = office.archivedAt !== null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t("menu", { name: office.name })}>
            <IconDotsVertical aria-hidden className="size-4.5" stroke={1.75} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem asChild>
            <Link href={`/offices/${office.id}`}>
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
            onSelect={() => void archive(office.id, archived)}
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
      <OfficeDrawer office={office} open={editing} onOpenChange={setEditing} />
    </>
  );
}
