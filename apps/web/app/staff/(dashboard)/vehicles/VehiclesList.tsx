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
import { carBodies, type CarBody, type Vehicle } from "@terhal/contracts";
import { RequireStaff } from "@/components/session/RequireSession";
import { ListPagination, useCursorList } from "@/components/staff/CursorList";
import { SearchBox } from "@/components/staff/SearchBox";
import { VehicleDrawer } from "@/components/staff/fleet/VehicleDrawer";
import { KindBadge } from "@/components/staff/fleet/format";
import { VehicleThumb } from "@/components/staff/fleet/VehicleThumb";
import { useArchive } from "@/components/staff/fleet/useArchive";
import { officesQuery } from "@/components/staff/queries";
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

export function VehiclesList() {
  return <RequireStaff permission="fleet">{() => <Vehicles />}</RequireStaff>;
}

function Vehicles() {
  const t = useTranslations("staff.fleet.vehicles");
  const list = useTranslations("staff.list");
  const common = useTranslations("staff.common");
  const kinds = useTranslations("staff.fleet.kinds");
  const cars = useTranslations("staff.trips.car");
  const errorMessage = useErrorMessage();
  const [adding, setAdding] = useState(false);
  const offices = useQuery(officesQuery);
  const vehicles = useCursorList(
    ["staff", "vehicles"],
    {
      archived: "false" as Flag,
      q: "",
      body: "" as CarBody | "",
      external: "" as Flag | "",
      officeId: "",
    },
    (query) => call(staffApi.vehicles.$get({ query })),
  );
  const { filters, setFilter, rows, result } = vehicles;
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
              <a href={`${endpoint}/v1/staff/exports/vehicles.csv`} download>
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
          aria-label={t("body")}
          value={filters.body}
          onChange={(event) => setFilter("body", event.target.value as CarBody | "")}
          className="sm:w-36"
        >
          <option value="">{t("allBodies")}</option>
          {carBodies.map((body) => (
            <option key={body} value={body}>
              {cars(body)}
            </option>
          ))}
        </Select>
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
      </div>

      {/* Phones: one card per vehicle. */}
      <AutoHeight className="md:hidden">
        <ul
          aria-busy={result.isFetching || undefined}
          className={cn("flex flex-col gap-3 transition-opacity", stale && "opacity-60")}
        >
          {result.isPending ? (
            <VehicleCardsLoading />
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
            rows.map((vehicle) => <VehicleCard key={vehicle.id} vehicle={vehicle} />)
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
              <TableHead>{t("columns.vehicle")}</TableHead>
              <TableHead>{t("columns.body")}</TableHead>
              <TableHead>{t("columns.type")}</TableHead>
              <TableHead>{t("columns.office")}</TableHead>
              <TableHead>{t("columns.photos")}</TableHead>
              <TableHead>
                <span className="sr-only">{list("actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.isPending ? (
              <VehicleRowsLoading />
            ) : result.isError ? (
              <TableEmpty columns={COLUMNS} title={errorMessage(result.error)} />
            ) : rows.length === 0 ? (
              <TableEmpty columns={COLUMNS} title={t("empty")} description={t("emptyHint")} />
            ) : (
              rows.map((vehicle) => <VehicleRow key={vehicle.id} vehicle={vehicle} />)
            )}
          </TableBody>
        </Table>
      </AutoHeight>
      <ListPagination list={vehicles} />

      <VehicleDrawer open={adding} onOpenChange={setAdding} />
    </>
  );
}

function VehicleRow({ vehicle }: { vehicle: Vehicle }) {
  const list = useTranslations("staff.list");
  const cars = useTranslations("staff.trips.car");
  const router = useRouter();
  const href = `/vehicles/${vehicle.id}`;

  return (
    <MotionTableRow
      {...fade}
      className="cursor-pointer hover:bg-surface-muted/50"
      onClick={() => router.push(href)}
    >
      <TableCell>
        <div className="flex items-center gap-2.5">
          <VehicleThumb vehicle={vehicle} />
          <div className="flex min-w-0 flex-col">
            <Link
              href={href}
              onClick={(event) => event.stopPropagation()}
              className="truncate text-sm font-medium text-foreground hover:underline"
            >
              {vehicle.make} {vehicle.model} {vehicle.year}
            </Link>
            <span className="text-xs text-muted">
              <span dir="ltr">{vehicle.plateNumber}</span> · {vehicle.color}
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Badge tone="neutral">{cars(vehicle.body)}</Badge>
      </TableCell>
      <TableCell>
        <KindBadge item={vehicle} />
      </TableCell>
      <TableCell className="text-sm">{vehicle.office?.name ?? list("none")}</TableCell>
      <TableCell>
        <PhotoCount vehicle={vehicle} />
      </TableCell>
      <TableCell className="w-11 px-2" onClick={(event) => event.stopPropagation()}>
        <VehicleMenu vehicle={vehicle} />
      </TableCell>
    </MotionTableRow>
  );
}

function PhotoCount({ vehicle }: { vehicle: Vehicle }) {
  const t = useTranslations("staff.fleet.vehicles");
  const count = vehicle.images.length;
  return (
    <span className={cn("text-[0.8125rem]", count === 0 ? "text-warning" : "text-muted")}>
      {count === 0 ? t("noPhotos") : t("photoCount", { count })}
    </span>
  );
}

function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  const cars = useTranslations("staff.trips.car");
  return (
    <motion.li {...fade}>
      <Link
        href={`/vehicles/${vehicle.id}`}
        className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-muted/50"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <VehicleThumb vehicle={vehicle} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-foreground">
                {vehicle.make} {vehicle.model} {vehicle.year}
              </span>
              <span className="text-xs text-muted">
                <span dir="ltr">{vehicle.plateNumber}</span> · {vehicle.color}
              </span>
            </div>
          </div>
          <KindBadge item={vehicle} />
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <Badge tone="neutral">{cars(vehicle.body)}</Badge>
          <div className="flex flex-col items-end">
            <PhotoCount vehicle={vehicle} />
            {vehicle.office && <span className="text-xs text-muted">{vehicle.office.name}</span>}
          </div>
        </div>
      </Link>
    </motion.li>
  );
}

// The first page loading: rows shaped like the vehicles they stand in for, so nothing moves when they arrive.
function VehicleRowsLoading() {
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
              <Skeleton className="size-10 shrink-0 rounded-lg" />
              <SkeletonLines first={row % 2 ? "w-40" : "w-32"} second="w-28" />
            </div>
          </TableCell>
          <TableCell>
            <Skeleton className="h-5.5 w-16 rounded-full" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-5.5 w-20 rounded-full" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-24" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-16" />
          </TableCell>
          <TableCell className="w-11 px-2">
            <Skeleton className="size-8 rounded-lg" />
          </TableCell>
        </motion.tr>
      ))}
    </>
  );
}

function VehicleCardsLoading() {
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
              <Skeleton className="size-10 rounded-lg" />
              <SkeletonLines first="w-36" second="w-28" />
            </div>
            <Skeleton className="h-5.5 w-20 rounded-full" />
          </div>
          <div className="flex items-center justify-between border-t border-border pt-3">
            <Skeleton className="h-5.5 w-16 rounded-full" />
            <Skeleton className="h-3.5 w-16" />
          </div>
        </motion.li>
      ))}
    </>
  );
}

function VehicleMenu({ vehicle }: { vehicle: Vehicle }) {
  const t = useTranslations("staff.fleet.vehicles");
  const common = useTranslations("staff.common");
  const archive = useArchive("vehicles");
  const [editing, setEditing] = useState(false);
  const archived = vehicle.archivedAt !== null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("menu", { name: `${vehicle.make} ${vehicle.model}` })}
          >
            <IconDotsVertical aria-hidden className="size-4.5" stroke={1.75} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem asChild>
            <Link href={`/vehicles/${vehicle.id}`}>
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
            onSelect={() => void archive(vehicle.id, archived)}
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
      <VehicleDrawer vehicle={vehicle} open={editing} onOpenChange={setEditing} />
    </>
  );
}
