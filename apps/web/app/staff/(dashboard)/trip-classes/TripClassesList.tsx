"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
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
import { call, staffApi, useErrorMessage } from "@/lib/api";

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
    query.data && <span className="ms-1.5 text-xs text-muted">{query.data.data.length}</span>;

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
      <Table>
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
            <TableLoading columns={COLUMNS} />
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
  const name = useLocalName();
  const other = name(tripClass) === tripClass.nameEn ? tripClass.nameAr : tripClass.nameEn;
  const description = name({
    nameEn: tripClass.descriptionEn ?? "",
    nameAr: tripClass.descriptionAr ?? "",
  });

  return (
    <TableRow className="cursor-pointer hover:bg-surface-muted/50" onClick={onEdit}>
      <TableCell className="text-sm text-muted tabular-nums">{tripClass.sortOrder}</TableCell>
      <TableCell>
        <div className="flex flex-col">
          <span className="text-sm font-medium text-foreground">{name(tripClass)}</span>
          <span className="text-xs text-muted">{other}</span>
        </div>
      </TableCell>
      <TableCell className="max-w-96 truncate text-sm text-muted">{description || "—"}</TableCell>
      <TableCell className="text-sm tabular-nums">{tripClass.prices}</TableCell>
      <TableCell className="text-sm tabular-nums">{tripClass.tripsThisMonth}</TableCell>
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
    </TableRow>
  );
}
