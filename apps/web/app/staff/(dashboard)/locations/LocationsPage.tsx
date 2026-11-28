"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  IconChevronRight,
  IconDotsVertical,
  IconPencil,
  IconPlus,
  IconRestore,
} from "@tabler/icons-react";
import type { Location } from "@terhal/contracts";
import { DirectionalIcon } from "@/components/DirectionalIcon";
import { RequireStaff } from "@/components/session/RequireSession";
import { SearchBox } from "@/components/staff/SearchBox";
import { AddLocationDrawer } from "@/components/staff/locations/AddLocationDrawer";
import { LocationDrawer } from "@/components/staff/locations/LocationDrawer";
import { locationsKey, toKm } from "@/components/staff/locations/shared";
import { useLocalName } from "@/components/staff/trips/format";
import { Badge } from "@/components/ui/Badge";
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
import { toast } from "@/components/ui/Toast";
import { call, staffApi, useErrorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

export function LocationsPage() {
  return <RequireStaff permission="pricing">{() => <Locations />}</RequireStaff>;
}

type Tab = "live" | "deleted";
const COLUMNS = 4;

// What a row can ask the page for: its side panel, or the add panel with it as the parent.
type RowActions = {
  onOpen: (location: Location) => void;
  onAddInside: (location: Location) => void;
};

function Locations() {
  const t = useTranslations("staff.locations");
  const list = useTranslations("staff.list");
  const [tab, setTab] = useState<Tab>("live");
  const [q, setQ] = useState("");
  const [opened, setOpened] = useState<Location | null>(null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState<{ parent: Location | null } | null>(null);
  const actions: RowActions = {
    onOpen: (location) => {
      setOpened(location);
      setEditing(true);
    },
    onAddInside: (location) => setAdding({ parent: location }),
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button onClick={() => setAdding({ parent: null })}>
            <IconPlus aria-hidden className="size-5" stroke={1.75} />
            {t("addLocation")}
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList>
          <TabsTrigger value="live">{t("live")}</TabsTrigger>
          <TabsTrigger value="deleted">{t("deletedTab")}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchBox initial={q} onSearch={setQ} placeholder={t("search")} />
      </div>

      <AutoHeight>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.place")}</TableHead>
              <TableHead>{t("columns.type")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("columns.radius")}</TableHead>
              <TableHead>
                <span className="sr-only">{list("actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Governorates opening into their districts and areas; a search or the deleted ones as a flat list. */}
            {tab === "deleted" || q ? (
              <FlatRows key={`${tab}-${q}`} q={q} deleted={tab === "deleted"} {...actions} />
            ) : (
              <Branch parentId={null} depth={0} {...actions} />
            )}
          </TableBody>
        </Table>
      </AutoHeight>

      <LocationDrawer location={opened} open={editing} onOpenChange={setEditing} />
      <AddLocationDrawer
        parent={adding?.parent ?? null}
        open={adding !== null}
        onOpenChange={(open) => !open && setAdding(null)}
        onAdded={() => setAdding(null)}
      />
    </>
  );
}

const childrenQuery = (parentId: string | null) => ({
  queryKey: [...locationsKey, "children", parentId],
  queryFn: () =>
    call(
      staffApi.locations.$get({
        query: parentId ? { parentId, limit: "200" } : { locality: "GOVERNORATE", limit: "200" },
      }),
    ),
});

// A level of the tree: its places as rows, each with its own children under it once it's opened.
function Branch({
  parentId,
  depth,
  ...actions
}: RowActions & { parentId: string | null; depth: number }) {
  const t = useTranslations("staff.locations");
  const errorMessage = useErrorMessage();
  const children = useQuery(childrenQuery(parentId));

  if (children.isPending) return <PlaceRowsLoading depth={depth} rows={depth === 0 ? 8 : 2} />;
  if (children.isError) {
    return <TableEmpty columns={COLUMNS} title={errorMessage(children.error)} />;
  }
  if (children.data.data.length === 0) {
    return depth === 0 ? (
      <TableEmpty columns={COLUMNS} title={t("noResults")} />
    ) : (
      <motion.tr {...fade} className="border-b border-border">
        <TableCell colSpan={COLUMNS} className="py-2.5 text-xs text-muted">
          <span style={{ paddingInlineStart: indent(depth, true) }}>{t("noChildren")}</span>
        </TableCell>
      </motion.tr>
    );
  }
  return children.data.data.map((location) => (
    <PlaceRow key={location.id} location={location} depth={depth} {...actions} />
  ));
}

// How far a row's name sits in: a step per level, plus the chevron's width on rows that have none.
const indent = (depth: number, noChevron = false) =>
  `${String(depth * 1.5 + (noChevron ? 2 : 0))}rem`;

function PlaceRow({
  location,
  depth,
  ...actions
}: RowActions & { location: Location; depth: number }) {
  const t = useTranslations("staff.locations");
  const [open, setOpen] = useState(false);
  const leaf = location.locality === "AREA";

  return (
    <>
      <MotionTableRow
        {...fade}
        className="cursor-pointer hover:bg-hover"
        onClick={() => actions.onOpen(location)}
      >
        <TableCell>
          <div className="flex items-center gap-2" style={{ paddingInlineStart: indent(depth) }}>
            {leaf ? (
              <span aria-hidden className="size-6 shrink-0" />
            ) : (
              <button
                type="button"
                aria-expanded={open}
                aria-label={open ? t("collapse") : t("expand")}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpen(!open);
                }}
                className="grid size-6 shrink-0 place-items-center rounded-md text-muted transition-colors duration-200 hover:bg-hover hover:text-foreground focus-visible:bg-hover focus-visible:outline-none"
              >
                <DirectionalIcon
                  icon={IconChevronRight}
                  className={cn(
                    "size-4 transition-transform duration-200",
                    open && "rotate-90 rtl:-rotate-90",
                  )}
                  stroke={1.75}
                />
              </button>
            )}
            <PlaceName location={location} />
          </div>
        </TableCell>
        <PlaceCells location={location} />
        <TableCell className="w-11 px-2" onClick={(event) => event.stopPropagation()}>
          <PlaceMenu location={location} {...actions} />
        </TableCell>
      </MotionTableRow>
      {open && !leaf && <Branch parentId={location.id} depth={depth + 1} {...actions} />}
    </>
  );
}

function PlaceName({ location }: { location: Location }) {
  const name = useLocalName();
  const other = name(location) === location.nameEn ? location.nameAr : location.nameEn;
  return (
    <div className="flex min-w-0 flex-col">
      <span className="truncate text-sm font-medium text-foreground">{name(location)}</span>
      <span className="truncate text-xs text-muted">{other}</span>
    </div>
  );
}

// Its kind, and its radius (a district's or an area's) or whether it's booked whole (a governorate's).
function PlaceCells({ location }: { location: Location }) {
  const t = useTranslations("staff.locations");
  const list = useTranslations("staff.list");
  return (
    <>
      <TableCell className="whitespace-nowrap text-muted">
        {t(`localities.${location.locality}`)}
      </TableCell>
      <TableCell className="hidden whitespace-nowrap sm:table-cell">
        {location.center ? (
          <span className="tabular-nums">
            {t("radiusValue", { km: toKm(location.center.radius) })}
          </span>
        ) : location.flexible ? (
          <Badge tone="primary">{t("wholeGovernorate")}</Badge>
        ) : (
          <span className="text-muted">{list("none")}</span>
        )}
      </TableCell>
    </>
  );
}

function PlaceMenu({ location, onOpen, onAddInside }: RowActions & { location: Location }) {
  const t = useTranslations("staff.locations");
  const name = useLocalName();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("menu", { name: name(location) })}>
          <IconDotsVertical aria-hidden className="size-4.5" stroke={1.75} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => onOpen(location)}>
          <IconPencil aria-hidden className="size-4" stroke={1.75} />
          {location.locality === "GOVERNORATE" ? t("open") : t("edit")}
        </DropdownMenuItem>
        {location.locality !== "AREA" && (
          <DropdownMenuItem onSelect={() => onAddInside(location)}>
            <IconPlus aria-hidden className="size-4" stroke={1.75} />
            {t("addInside")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Search results, or deleted places with a restore on the ones that were deleted directly.
function FlatRows({ q, deleted, ...actions }: RowActions & { q: string; deleted: boolean }) {
  const t = useTranslations("staff.locations");
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const results = useQuery({
    queryKey: [...locationsKey, "flat", { q, deleted }],
    queryFn: () =>
      call(
        staffApi.locations.$get({
          query: { ...(q && { q }), deleted: deleted ? "true" : "false", limit: "100" },
        }),
      ),
  });

  const restore = async (location: Location) => {
    try {
      const restored = await call(
        staffApi.locations[":id"].restore.$post({ param: { id: location.id } }),
      );
      await client.invalidateQueries({ queryKey: locationsKey });
      toast.success(t("restored", { count: restored.count }));
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
  };

  if (results.isPending) return <PlaceRowsLoading depth={0} rows={6} />;
  if (results.isError) {
    return <TableEmpty columns={COLUMNS} title={errorMessage(results.error)} />;
  }
  if (results.data.data.length === 0) {
    return <TableEmpty columns={COLUMNS} title={deleted ? t("noneDeleted") : t("noResults")} />;
  }
  return results.data.data.map((location) => (
    <MotionTableRow
      key={location.id}
      {...fade}
      className={cn(!deleted && "cursor-pointer hover:bg-hover")}
      onClick={deleted ? undefined : () => actions.onOpen(location)}
    >
      <TableCell>
        <PlaceName location={location} />
      </TableCell>
      <PlaceCells location={location} />
      <TableCell
        className={deleted ? "px-2 text-end" : "w-11 px-2"}
        onClick={(event) => event.stopPropagation()}
      >
        {deleted ? (
          location.deletedWithId === location.id && (
            <Button variant="ghost" size="sm" onClick={() => void restore(location)}>
              <IconRestore aria-hidden className="size-4" stroke={1.75} />
              {t("restore")}
            </Button>
          )
        ) : (
          <PlaceMenu location={location} {...actions} />
        )}
      </TableCell>
    </MotionTableRow>
  ));
}

// Rows in gray at a level of the tree, shaped like the places they stand in for.
function PlaceRowsLoading({ depth, rows }: { depth: number; rows: number }) {
  const t = useTranslations("common.ui");
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <motion.tr
          key={row}
          {...fade}
          className="border-b border-border"
          aria-hidden={row > 0 || undefined}
        >
          <TableCell>
            {row === 0 && <span className="sr-only">{t("loading")}</span>}
            <div className="flex items-center gap-2" style={{ paddingInlineStart: indent(depth) }}>
              <Skeleton className="size-6 shrink-0 rounded-md" />
              <SkeletonLines first={row % 3 ? "w-28" : "w-36"} second="w-20" />
            </div>
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-20" />
          </TableCell>
          <TableCell className="hidden sm:table-cell">
            <Skeleton className="h-3.5 w-14" />
          </TableCell>
          <TableCell className="w-11 px-2">
            <Skeleton className="size-8 rounded-lg" />
          </TableCell>
        </motion.tr>
      ))}
    </>
  );
}
