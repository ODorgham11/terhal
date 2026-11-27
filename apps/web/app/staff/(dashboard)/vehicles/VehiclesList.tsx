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
      </div>

      <Table>
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
            <TableLoading columns={COLUMNS} />
          ) : result.isError ? (
            <TableEmpty columns={COLUMNS} title={errorMessage(result.error)} />
          ) : rows.length === 0 ? (
            <TableEmpty columns={COLUMNS} title={t("empty")} description={t("emptyHint")} />
          ) : (
            rows.map((vehicle) => <VehicleRow key={vehicle.id} vehicle={vehicle} />)
          )}
        </TableBody>
      </Table>
      <ListPagination list={vehicles} />

      <VehicleDrawer open={adding} onOpenChange={setAdding} />
    </>
  );
}

function VehicleRow({ vehicle }: { vehicle: Vehicle }) {
  const t = useTranslations("staff.fleet.vehicles");
  const list = useTranslations("staff.list");
  const cars = useTranslations("staff.trips.car");
  const router = useRouter();
  const href = `/vehicles/${vehicle.id}`;

  return (
    <TableRow
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
      <TableCell
        className={vehicle.images.length === 0 ? "text-sm text-warning" : "text-sm text-muted"}
      >
        {vehicle.images.length === 0
          ? t("noPhotos")
          : t("photoCount", { count: vehicle.images.length })}
      </TableCell>
      <TableCell className="w-11 px-2" onClick={(event) => event.stopPropagation()}>
        <VehicleMenu vehicle={vehicle} />
      </TableCell>
    </TableRow>
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
