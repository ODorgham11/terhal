"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
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
import { Checkbox } from "@/components/ui/Checkbox";
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
import { toast } from "@/components/ui/Toast";
import { call, endpoint, staffApi, useErrorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

const COLUMNS = 9;
// From is only as wide as its longest name, then the arrow with the same 16px on each side, then to: the arrow sits
// right between the two places instead of floating in the middle of a half-empty column.
const FROM = "w-px whitespace-nowrap pe-4";
const ARROW = "w-4 px-0";
const TO = "ps-4";

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
  // Rows from the last filter stay up, dimmed, until the new ones arrive, so the table never empties out.
  const stale = result.isPlaceholderData;

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
        {/* Held by a skeleton while the classes load, so the row doesn't shift when they arrive. */}
        {classes.data ? (
          <motion.div {...fade}>
            <Select
              aria-label={t("columns.class")}
              value={filters.classId}
              onChange={(event) => setFilter("classId", event.target.value)}
            >
              <option value="">{t("allClasses")}</option>
              {classes.data.data.map((tripClass) => (
                <option key={tripClass.id} value={tripClass.id}>
                  {name(tripClass)}
                </option>
              ))}
            </Select>
          </motion.div>
        ) : (
          <Skeleton className="h-10 w-full rounded-lg" />
        )}
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

      {/* Opens above the table while rows are picked, and closes again when none are. */}
      <AnimatePresence initial={false}>
        {selected.size > 0 && (
          <motion.div
            key="selection"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={fade.transition}
            className="-mt-6 overflow-hidden"
          >
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-primary-soft px-4 py-2.5">
              <span className="text-sm font-medium text-primary tabular-nums">
                <FadeText value={t("selected", { count: selected.size })} />
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
          </motion.div>
        )}
      </AnimatePresence>

      {/* Phones: one card per price. */}
      <AutoHeight className="md:hidden">
        <ul
          aria-busy={result.isFetching || undefined}
          className={cn("flex flex-col gap-3 transition-opacity", stale && "opacity-60")}
        >
          {result.isPending ? (
            <PriceCardsLoading />
          ) : result.isError ? (
            <motion.li {...fade} className="py-10 text-center text-sm text-danger">
              {errorMessage(result.error)}
            </motion.li>
          ) : rows.length === 0 ? (
            <motion.li {...fade} className="flex flex-col items-center gap-0.5 py-10 text-center">
              <span className="text-base font-semibold text-foreground">{t("empty")}</span>
              <span className="text-[0.8125rem] text-muted">{t("emptyHint")}</span>
            </motion.li>
          ) : (
            rows.map((row) => (
              <PriceCard
                key={row.id}
                row={row}
                selected={selected.has(row.id)}
                onToggle={() => toggle(row)}
                onChange={() => setDialog({ kind: "change", rows: [row] })}
                onDelete={() => setDialog({ kind: "delete", rows: [row] })}
              />
            ))
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
              <TableHead className="w-10">
                <Checkbox
                  className="gap-0"
                  label={<span className="sr-only">{t("selectPage")}</span>}
                  checked={pageSelected}
                  onChange={togglePage}
                />
              </TableHead>
              <TableHead className={FROM}>{t("columns.from")}</TableHead>
              <TableHead className={ARROW} aria-hidden />
              <TableHead className={TO}>{t("columns.to")}</TableHead>
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
              <PriceRowsLoading />
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
      </AutoHeight>
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
    <MotionTableRow
      {...fade}
      className={cn(
        "transition-colors",
        selected && "bg-primary-soft/50",
        !row.active && "text-muted opacity-70",
      )}
    >
      <TableCell>
        <Checkbox
          className="gap-0"
          label={
            <span className="sr-only">
              {t("selectRow", { from: name(row.from), to: name(row.to) })}
            </span>
          }
          checked={selected}
          onChange={onToggle}
        />
      </TableCell>
      <TableCell className={FROM}>
        <Place place={row.from} />
      </TableCell>
      <TableCell className={ARROW}>
        <DirectionalIcon icon={IconArrowRight} className="block size-4 text-muted" />
      </TableCell>
      <TableCell className={TO}>
        <Place place={row.to} />
      </TableCell>
      <TableCell>{name(row.class)}</TableCell>
      <TableCell>{cars(row.car)}</TableCell>
      <TableCell className="font-medium whitespace-nowrap tabular-nums">
        {price(row.price)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted">
        {row.active ? (
          day(row.updatedAt)
        ) : (
          <Badge tone="neutral" dot>
            {t("inactive")}
          </Badge>
        )}
      </TableCell>
      <TableCell className="w-11 px-2">
        <PriceMenu onChange={onChange} onDelete={onDelete} />
      </TableCell>
    </MotionTableRow>
  );
}

function PriceMenu({ onChange, onDelete }: { onChange: () => void; onDelete: () => void }) {
  const t = useTranslations("staff.pricing");
  return (
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
  );
}

function PriceCard({
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
    <motion.li
      {...fade}
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 transition-colors",
        selected && "border-primary/40 bg-primary-soft/50",
        !row.active && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <Checkbox
            className="gap-0"
            label={
              <span className="sr-only">
                {t("selectRow", { from: name(row.from), to: name(row.to) })}
              </span>
            }
            checked={selected}
            onChange={onToggle}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <Place place={row.from} />
            <Place place={row.to} />
          </div>
        </div>
        <PriceMenu onChange={onChange} onDelete={onDelete} />
      </div>
      <div className="flex items-end justify-between gap-3 border-t border-border pt-3 text-[0.8125rem]">
        <div className="flex flex-col">
          <span className="text-foreground">
            {name(row.class)} · {cars(row.car)}
          </span>
          <span className="text-xs text-muted">
            {row.active ? day(row.updatedAt) : t("inactive")}
          </span>
        </div>
        <span className="font-medium text-foreground tabular-nums">{price(row.price)}</span>
      </div>
    </motion.li>
  );
}

// The first page loading: rows shaped like the prices they stand in for, so nothing moves when they arrive.
function PriceRowsLoading() {
  const t = useTranslations("common.ui");
  return (
    <>
      {Array.from({ length: 8 }, (_, row) => (
        <motion.tr
          key={row}
          {...fade}
          className="border-b border-border"
          aria-hidden={row > 0 || undefined}
        >
          <TableCell>
            {row === 0 && <span className="sr-only">{t("loading")}</span>}
            <Skeleton className="size-4.5 rounded-[0.3125rem]" />
          </TableCell>
          <TableCell className={FROM}>
            <SkeletonLines first={row % 2 ? "w-24" : "w-32"} second="w-16" />
          </TableCell>
          <TableCell className={ARROW}>
            <Skeleton className="size-4" />
          </TableCell>
          <TableCell className={TO}>
            <SkeletonLines first={row % 2 ? "w-28" : "w-24"} second="w-16" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-16" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-14" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-20" />
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

function PriceCardsLoading() {
  return (
    <>
      {[0, 1, 2].map((card) => (
        <motion.li
          key={card}
          {...fade}
          aria-hidden
          className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
        >
          <div className="flex items-start gap-3">
            <Skeleton className="size-4.5 rounded-[0.3125rem]" />
            <div className="flex flex-col gap-2">
              <SkeletonLines first="w-32" second="w-16" />
              <SkeletonLines first="w-28" second="w-16" />
            </div>
          </div>
          <div className="flex items-end justify-between border-t border-border pt-3">
            <SkeletonLines first="w-28" second="w-20" />
            <Skeleton className="h-3.5 w-20" />
          </div>
        </motion.li>
      ))}
    </>
  );
}
