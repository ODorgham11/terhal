"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { IconDotsVertical, IconPencil, IconPlus } from "@tabler/icons-react";
import type { StaffTripClass } from "@terhal/contracts";
import { RequireStaff } from "@/components/session/RequireSession";
import { TripClassDrawer } from "@/components/staff/pricing/TripClassDrawer";
import { useLocalName } from "@/components/staff/trips/format";
import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { PageHeader } from "@/components/ui/PageHeader";
import { AutoHeight, FadeText, fade } from "@/components/ui/Motion";
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

const COLUMNS = 6;
type Tab = "false" | "true";

export function TripClassesList() {
  return <RequireStaff permission="pricing">{() => <TripClasses />}</RequireStaff>;
}

const classesQuery = (archived: Tab) => ({
  queryKey: ["staff", "trip-classes", "list", archived],
  queryFn: () => call(staffApi["trip-classes"].$get({ query: { archived } })),
});

function TripClasses() {
  const t = useTranslations("staff.tripClasses");
  const list = useTranslations("staff.list");
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const [tab, setTab] = useState<Tab>("false");
  const [editing, setEditing] = useState<StaffTripClass | "new" | null>(null);
  const active = useQuery(classesQuery("false"));
  const archived = useQuery(classesQuery("true"));
  const shown = tab === "false" ? active : archived;
  const month = format.dateTime(new Date(), { month: "short" });

  const count = (query: typeof active) =>
    query.data && (
      <span className="ms-1.5 text-xs text-muted tabular-nums">
        <FadeText value={query.data.data.length} />
      </span>
    );

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button onClick={() => setEditing("new")}>
            <IconPlus aria-hidden className="size-5" stroke={1.75} />
            {t("add")}
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList>
          <TabsTrigger value="false">
            {list("active")}
            {count(active)}
          </TabsTrigger>
          <TabsTrigger value="true">
            {list("archived")}
            {count(archived)}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {/* Phones: one card per class. */}
      <AutoHeight className="md:hidden">
        <ul className="flex flex-col gap-3">
          {shown.isPending ? (
            <ClassCardsLoading />
          ) : shown.isError ? (
            <motion.li {...fade} className="py-10 text-center text-sm text-danger">
              {errorMessage(shown.error)}
            </motion.li>
          ) : shown.data.data.length === 0 ? (
            <motion.li {...fade} className="flex flex-col items-center gap-0.5 py-10 text-center">
              <span className="text-base font-semibold text-foreground">
                {tab === "false" ? t("empty") : t("emptyArchived")}
              </span>
              {tab === "false" && (
                <span className="text-[0.8125rem] text-muted">{t("emptyHint")}</span>
              )}
            </motion.li>
          ) : (
            shown.data.data.map((tripClass) => (
              <ClassCard
                key={tripClass.id}
                tripClass={tripClass}
                month={month}
                onEdit={() => setEditing(tripClass)}
              />
            ))
          )}
        </ul>
      </AutoHeight>

      <AutoHeight className="hidden md:block">
        <Table aria-busy={shown.isFetching || undefined}>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">{t("columns.order")}</TableHead>
              <TableHead>{t("columns.class")}</TableHead>
              <TableHead>{t("columns.description")}</TableHead>
              <TableHead>{t("columns.prices")}</TableHead>
              <TableHead>{t("columns.trips", { month })}</TableHead>
              <TableHead>
                <span className="sr-only">{list("actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.isPending ? (
              <ClassRowsLoading />
            ) : shown.isError ? (
              <TableEmpty columns={COLUMNS} title={errorMessage(shown.error)} />
            ) : shown.data.data.length === 0 ? (
              <TableEmpty
                columns={COLUMNS}
                title={tab === "false" ? t("empty") : t("emptyArchived")}
                description={tab === "false" ? t("emptyHint") : undefined}
              />
            ) : (
              shown.data.data.map((tripClass) => (
                <ClassRow
                  key={tripClass.id}
                  tripClass={tripClass}
                  onEdit={() => setEditing(tripClass)}
                />
              ))
            )}
          </TableBody>
        </Table>
      </AutoHeight>
      <TripClassDrawer
        tripClass={editing === "new" || editing === null ? undefined : editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </>
  );
}

function ClassRow({ tripClass, onEdit }: { tripClass: StaffTripClass; onEdit: () => void }) {
  const t = useTranslations("staff.tripClasses");
  const list = useTranslations("staff.list");
  const name = useLocalName();
  const other = name(tripClass) === tripClass.nameEn ? tripClass.nameAr : tripClass.nameEn;
  const description = name({
    nameEn: tripClass.descriptionEn ?? "",
    nameAr: tripClass.descriptionAr ?? "",
  });

  return (
    <MotionTableRow {...fade} className="cursor-pointer hover:bg-hover" onClick={onEdit}>
      <TableCell className="text-muted tabular-nums">{tripClass.sortOrder}</TableCell>
      <TableCell>
        <div className="flex flex-col">
          <span className="text-sm font-medium text-foreground">{name(tripClass)}</span>
          <span className="text-xs text-muted">{other}</span>
        </div>
      </TableCell>
      <TableCell className="max-w-96 truncate text-muted">{description || list("none")}</TableCell>
      <TableCell className="tabular-nums">{tripClass.prices}</TableCell>
      <TableCell className="tabular-nums">{tripClass.tripsThisMonth}</TableCell>
      <TableCell className="w-11 px-2" onClick={(event) => event.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("menu", { name: name(tripClass) })}>
              <IconDotsVertical aria-hidden className="size-4.5" stroke={1.75} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onEdit}>
              <IconPencil aria-hidden className="size-4" stroke={1.75} />
              {t("edit")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </MotionTableRow>
  );
}

function ClassCard({
  tripClass,
  month,
  onEdit,
}: {
  tripClass: StaffTripClass;
  month: string;
  onEdit: () => void;
}) {
  const t = useTranslations("staff.tripClasses");
  const name = useLocalName();
  const other = name(tripClass) === tripClass.nameEn ? tripClass.nameAr : tripClass.nameEn;
  return (
    <motion.li {...fade}>
      <button
        type="button"
        onClick={onEdit}
        className="flex w-full flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-start transition-colors hover:bg-hover"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium text-foreground">{name(tripClass)}</span>
            <span className="text-xs text-muted">{other}</span>
          </div>
          <span className="text-xs text-muted tabular-nums">#{tripClass.sortOrder}</span>
        </div>
        <div className="flex items-end justify-between gap-3 border-t border-border pt-3 text-[0.8125rem]">
          <span className="text-muted">
            {t("columns.prices")}{" "}
            <span className="font-medium text-foreground tabular-nums">{tripClass.prices}</span>
          </span>
          <span className="text-muted">
            {t("columns.trips", { month })}{" "}
            <span className="font-medium text-foreground tabular-nums">
              {tripClass.tripsThisMonth}
            </span>
          </span>
        </div>
      </button>
    </motion.li>
  );
}

// Rows shaped like the classes they stand in for, so nothing moves when they arrive.
function ClassRowsLoading() {
  const t = useTranslations("common.ui");
  return (
    <>
      {Array.from({ length: 4 }, (_, row) => (
        <motion.tr
          key={row}
          {...fade}
          className="border-b border-border"
          aria-hidden={row > 0 || undefined}
        >
          <TableCell className="w-20">
            {row === 0 && <span className="sr-only">{t("loading")}</span>}
            <Skeleton className="h-3.5 w-5" />
          </TableCell>
          <TableCell>
            <SkeletonLines first={row % 2 ? "w-24" : "w-32"} second="w-20" />
          </TableCell>
          <TableCell>
            <Skeleton className={cn("h-3.5", row % 2 ? "w-56" : "w-72")} />
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-6" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-8" />
          </TableCell>
          <TableCell className="w-11 px-2">
            <Skeleton className="size-8 rounded-lg" />
          </TableCell>
        </motion.tr>
      ))}
    </>
  );
}

function ClassCardsLoading() {
  return (
    <>
      {[0, 1, 2].map((card) => (
        <motion.li
          key={card}
          {...fade}
          aria-hidden
          className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
        >
          <SkeletonLines first="w-32" second="w-20" />
          <div className="flex items-end justify-between border-t border-border pt-3">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3.5 w-28" />
          </div>
        </motion.li>
      ))}
    </>
  );
}
