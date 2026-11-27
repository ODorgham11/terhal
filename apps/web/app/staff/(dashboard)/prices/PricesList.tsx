"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconArrowRight,
  IconDotsVertical,
  IconDownload,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { carBodies, type CarBody, type PricingRow } from "@terhal/contracts";
import { DirectionalIcon } from "@/components/DirectionalIcon";
import { RequireStaff } from "@/components/session/RequireSession";
import { ConfirmDialog } from "@/components/staff/ConfirmDialog";
import { ListPagination, useCursorList } from "@/components/staff/CursorList";
import { LocationPicker, type PickedLocation } from "@/components/staff/LocationPicker";
import { SearchBox } from "@/components/staff/SearchBox";
import { ChangePriceDialog } from "@/components/staff/pricing/ChangePriceDialog";
import { ImportPricesDialog } from "@/components/staff/pricing/ImportPricesDialog";
import { PriceDrawer } from "@/components/staff/pricing/PriceDrawer";
import { tripClassesQuery } from "@/components/staff/queries";
import { useLocalName, useTripDates } from "@/components/staff/trips/format";
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
import { toast } from "@/components/ui/Toast";
import { call, endpoint, staffApi, useErrorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

const COLUMNS = 8;

export function PricesList() {
  return <RequireStaff permission="pricing">{() => <Prices />}</RequireStaff>;
}

type Dialog = { kind: "add" | "import" } | { kind: "change" | "delete"; rows: PricingRow[] } | null;

function Prices() {
  const t = useTranslations("staff.pricing");
  const list = useTranslations("staff.list");
  const cars = useTranslations("staff.trips.car");
  const name = useLocalName();
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const classes = useQuery(tripClassesQuery);
  const [from, setFrom] = useState<PickedLocation | null>(null);
  const [to, setTo] = useState<PickedLocation | null>(null);
  const [selected, setSelected] = useState<Map<string, PricingRow>>(new Map());
  const [dialog, setDialog] = useState<Dialog>(null);
  const prices = useCursorList(
    ["staff", "pricing"],
    { q: "", fromId: "", toId: "", classId: "", car: "" as CarBody | "" },
    (query) => call(staffApi.pricing.$get({ query })),
    25,
  );
  const { filters, setFilter, rows, result } = prices;
  const pageSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));

  const toggle = (row: PricingRow) =>
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, row);
      return next;
    });
  const togglePage = () =>
    setSelected((current) => {
      const next = new Map(current);
      for (const row of rows) {
        if (pageSelected) next.delete(row.id);
        else next.set(row.id, row);
      }
      return next;
    });

  const remove = async (targets: PricingRow[]) => {
    for (const row of targets)
      await call(staffApi.pricing[":id"].$delete({ param: { id: row.id } }));
    setSelected(new Map());
    await client.invalidateQueries({ queryKey: ["staff", "pricing"] });
    toast.success(t("deleted", { count: targets.length }));
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Button asChild variant="secondary">
              <a href={`${endpoint}/v1/staff/pricing/export.csv`} download>
                <IconDownload aria-hidden className="size-5" stroke={1.75} />
                {list("exportCsv")}
              </a>
            </Button>
            <Button variant="secondary" onClick={() => setDialog({ kind: "import" })}>
              <IconUpload aria-hidden className="size-5" stroke={1.75} />
              {t("importCsv")}
            </Button>
            <Button onClick={() => setDialog({ kind: "add" })}>
              <IconPlus aria-hidden className="size-5" stroke={1.75} />
              {t("addPrice")}
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_10rem_9rem]">
        <SearchBox
          initial={filters.q}
          onSearch={(q) => setFilter("q", q)}
          placeholder={t("search")}
          className="sm:w-full"
        />
        <LocationPicker
          value={from}
          placeholder={t("fromAnywhere")}
          onChange={(location) => {
            setFrom(location);
            setFilter("fromId", location?.id ?? "");
          }}
        />
        <LocationPicker
          value={to}
          placeholder={t("toAnywhere")}
          onChange={(location) => {
            setTo(location);
            setFilter("toId", location?.id ?? "");
          }}
        />
        <Select
          aria-label={t("columns.class")}
          value={filters.classId}
          onChange={(event) => setFilter("classId", event.target.value)}
        >
          <option value="">{t("allClasses")}</option>
          {classes.data?.data.map((tripClass) => (
            <option key={tripClass.id} value={tripClass.id}>
              {name(tripClass)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t("columns.car")}
          value={filters.car}
          onChange={(event) => setFilter("car", event.target.value as CarBody | "")}
        >
          <option value="">{t("allCars")}</option>
          {carBodies.map((body) => (
            <option key={body} value={body}>
              {cars(body)}
            </option>
          ))}
        </Select>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-primary-soft px-4 py-2.5">
          <span className="text-sm font-medium text-primary">
            {t("selected", { count: selected.size })}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Map())}>
              {t("clearSelection")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDialog({ kind: "change", rows: [...selected.values()] })}
            >
              <IconPencil aria-hidden className="size-4" stroke={1.75} />
              {t("changePrice")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setDialog({ kind: "delete", rows: [...selected.values()] })}
            >
              {t("delete")}
            </Button>
          </div>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <input
                type="checkbox"
                aria-label={t("selectPage")}
                checked={pageSelected}
                onChange={togglePage}
                className="size-4 accent-primary"
              />
            </TableHead>
            <TableHead>{t("columns.from")}</TableHead>
            <TableHead>{t("columns.to")}</TableHead>
            <TableHead>{t("columns.class")}</TableHead>
            <TableHead>{t("columns.car")}</TableHead>
            <TableHead>{t("columns.price")}</TableHead>
            <TableHead>{t("columns.updated")}</TableHead>
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
            rows.map((row) => (
              <PriceRow
                key={row.id}
                row={row}
                selected={selected.has(row.id)}
                onToggle={() => toggle(row)}
                onChange={() => setDialog({ kind: "change", rows: [row] })}
                onDelete={() => setDialog({ kind: "delete", rows: [row] })}
              />
            ))
          )}
        </TableBody>
      </Table>
      <ListPagination list={prices} />

      <PriceDrawer
        open={dialog?.kind === "add"}
        onOpenChange={(open) => setDialog(open ? { kind: "add" } : null)}
      />
      <ImportPricesDialog
        open={dialog?.kind === "import"}
        onOpenChange={(open) => setDialog(open ? { kind: "import" } : null)}
      />
      <ChangePriceDialog
        rows={dialog?.kind === "change" ? dialog.rows : []}
        open={dialog?.kind === "change"}
        onOpenChange={(open) => !open && setDialog(null)}
        onDone={() => setSelected(new Map())}
      />
      <ConfirmDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t("deleteTitle", { count: dialog?.kind === "delete" ? dialog.rows.length : 0 })}
        description={t("deleteDescription")}
        confirmLabel={t("delete")}
        tone="danger"
        onConfirm={() => remove(dialog?.kind === "delete" ? dialog.rows : [])}
      />
    </>
  );
}

function Place({ place }: { place: PricingRow["from"] }) {
  const name = useLocalName();
  const localities = useTranslations("staff.locations.localities");
  const t = useTranslations("staff.pricing");
  return (
    <div className="flex flex-col">
      <span className="text-sm text-foreground">{name(place)}</span>
      <span className="text-xs text-muted">
        {localities(place.locality)}
        {place.deleted && ` · ${t("deletedPlace")}`}
      </span>
    </div>
  );
}

function PriceRow({
  row,
  selected,
  onToggle,
  onChange,
  onDelete,
}: {
  row: PricingRow;
  selected: boolean;
  onToggle: () => void;
  onChange: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("staff.pricing");
  const cars = useTranslations("staff.trips.car");
  const name = useLocalName();
  const { day, price } = useTripDates();

  return (
    <TableRow
      className={cn(selected && "bg-primary-soft/50", !row.active && "text-muted opacity-70")}
    >
      <TableCell>
        <input
          type="checkbox"
          aria-label={t("selectRow", { from: name(row.from), to: name(row.to) })}
          checked={selected}
          onChange={onToggle}
          className="size-4 accent-primary"
        />
      </TableCell>
      <TableCell>
        <Place place={row.from} />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-3">
          <DirectionalIcon icon={IconArrowRight} className="size-4 shrink-0 text-muted" />
          <Place place={row.to} />
        </div>
      </TableCell>
      <TableCell className="text-sm">{name(row.class)}</TableCell>
      <TableCell className="text-sm">{cars(row.car)}</TableCell>
      <TableCell className="text-sm font-medium whitespace-nowrap tabular-nums">
        {price(row.price)}
      </TableCell>
      <TableCell className="text-sm text-muted">
        {row.active ? (
          day(row.updatedAt)
        ) : (
          <Badge tone="neutral" dot>
            {t("inactive")}
          </Badge>
        )}
      </TableCell>
      <TableCell className="w-11 px-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("rowMenu")}>
              <IconDotsVertical aria-hidden className="size-4.5" stroke={1.75} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onChange}>
              <IconPencil aria-hidden className="size-4" stroke={1.75} />
              {t("changePrice")}
            </DropdownMenuItem>
            <DropdownMenuItem destructive onSelect={onDelete}>
              <IconTrash aria-hidden className="size-4" stroke={1.75} />
              {t("delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
