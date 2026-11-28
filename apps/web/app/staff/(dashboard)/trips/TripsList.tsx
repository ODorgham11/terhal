"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  IconArrowRight,
  IconCopy,
  IconDotsVertical,
  IconDownload,
  IconEye,
  IconPlus,
  IconSearch,
} from "@tabler/icons-react";
import { tripStatuses, type Staff, type Trip, type TripStatus } from "@terhal/contracts";
import { DirectionalIcon } from "@/components/DirectionalIcon";
import { RequireStaff } from "@/components/session/RequireSession";
import { TripAssignment } from "@/components/staff/trips/TripAssignment";
import { TripPrice } from "@/components/staff/trips/TripPrice";
import { TripStatusBadge } from "@/components/staff/trips/TripStatusBadge";
import { useLocalName, useTripDates } from "@/components/staff/trips/format";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { DateRangePicker } from "@/components/ui/DatePicker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { Input } from "@/components/ui/Input";
import { AutoHeight, fade } from "@/components/ui/Motion";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination, useCursorPages } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  MotionTableRow,
} from "@/components/ui/Table";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { toast } from "@/components/ui/Toast";
import { call, endpoint, staffApi, useErrorMessage } from "@/lib/api";
import { startOfCairoDay } from "@/lib/cairo";
import { cn } from "@/lib/cn";

const PAGE_SIZE = 20;
const COLUMNS = 8;

type Filters = {
  status: TripStatus | undefined;
  q: string;
  from: string; // yyyy-mm-dd, Cairo days
  to: string;
  officeId: string;
  unassigned: boolean;
};

// Only trips not yet under way can be waiting for a driver or an office; the filter shows on these tabs alone.
const canBeUnassigned = (status: TripStatus | undefined) =>
  status === undefined || status === "PENDING" || status === "CONFIRMED";

const isStatus = (value: string | null): value is TripStatus =>
  (tripStatuses as readonly string[]).includes(value ?? "");

// "2026-11-28" as the instant Cairo's day starts, and `days` after it.
const cairoDay = (date: string, days = 0) =>
  startOfCairoDay(new Date(`${date}T12:00:00Z`), days).toISOString();

export function TripsList() {
  return <RequireStaff permission="trips">{(staff) => <TripsPage staff={staff} />}</RequireStaff>;
}

function TripsPage({ staff }: { staff: Staff }) {
  const t = useTranslations("staff.trips.list");
  const statusNames = useTranslations("staff.trips.status");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const errorMessage = useErrorMessage();
  const pages = useCursorPages();

  const status = params.get("status");
  const filters: Filters = {
    status: isStatus(status) ? status : undefined,
    q: params.get("q") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    officeId: params.get("office") ?? "",
    unassigned: params.get("unassigned") === "true",
  };
  const unassignable = canBeUnassigned(filters.status);

  function setParams(values: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    pages.reset();
    router.replace(next.size ? `${pathname}?${next.toString()}` : pathname, { scroll: false });
  }
  const setParam = (key: string, value: string) => setParams({ [key]: value });

  const query = {
    ...(filters.status && { status: filters.status }),
    ...(filters.q && { q: filters.q }),
    ...(filters.from && { from: cairoDay(filters.from) }),
    ...(filters.to && { to: cairoDay(filters.to, 1) }),
    ...(filters.officeId && { officeId: filters.officeId }),
    ...(filters.unassigned && unassignable && { unassigned: "true" as const }),
    ...(pages.cursor && { cursor: pages.cursor }),
    limit: String(PAGE_SIZE),
  };
  const trips = useQuery({
    queryKey: ["staff", "trips", query],
    queryFn: () => call(staffApi.trips.$get({ query })),
    placeholderData: keepPreviousData,
  });

  const offices = useQuery({
    queryKey: ["staff", "offices", "all"],
    queryFn: () => call(staffApi.offices.$get({ query: { limit: "100" } })),
    enabled: staff.permissions.includes("fleet"),
    staleTime: 5 * 60_000,
  });

  const exportQuery = new URLSearchParams({
    ...(filters.status && { status: filters.status }),
    ...(filters.q && { q: filters.q }),
    ...(filters.from && { from: cairoDay(filters.from) }),
    ...(filters.to && { to: cairoDay(filters.to, 1) }),
    ...(filters.officeId && { officeId: filters.officeId }),
  });
  const rows = trips.data?.data ?? [];
  // Rows from the last filter stay up, dimmed, until the new ones arrive, so the table never empties out.
  const stale = trips.isPlaceholderData;
  const showOffices = staff.permissions.includes("fleet") && offices.data?.data.length !== 0;
  const first = (pages.page - 1) * PAGE_SIZE + 1;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Button asChild variant="secondary">
              <a href={`${endpoint}/v1/staff/exports/trips.csv?${exportQuery.toString()}`} download>
                <IconDownload aria-hidden className="size-5" stroke={1.75} />
                {t("export")}
              </a>
            </Button>
            <Button asChild>
              <Link href="/trips/new">
                <IconPlus aria-hidden className="size-5" stroke={1.75} />
                {t("newTrip")}
              </Link>
            </Button>
          </>
        }
      />

      <Tabs
        value={filters.status ?? "all"}
        onValueChange={(value) => {
          const status = value === "all" ? "" : value;
          // Leaving the tabs where trips can be unassigned drops that filter, rather than keeping it on unseen.
          setParams({
            status,
            ...(!canBeUnassigned(isStatus(status) ? status : undefined) && { unassigned: "" }),
          });
        }}
      >
        <TabsList aria-label={t("statusFilter")} className="gap-6">
          <TabsTrigger value="all" className="px-1">
            {t("all")}
          </TabsTrigger>
          {(
            [
              "PENDING",
              "CONFIRMED",
              "IN_PROGRESS",
              "AWAITING_REPORT",
              "COMPLETED",
              "CANCELLED",
            ] as const
          ).map((value) => (
            <TabsTrigger key={value} value={value} className="px-1">
              {statusNames(value)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-3">
        {/* Keyed by the URL's search, so the top bar's search replaces what's typed here. */}
        <SearchBox key={filters.q} initial={filters.q} onSearch={(q) => setParam("q", q)} />
        <DateRangePicker
          from={filters.from}
          to={filters.to}
          onChange={({ from, to }) => setParams({ from, to })}
          placeholder={t("anyDate")}
          aria-label={t("dates")}
          className="w-full sm:w-64"
        />
        {/* Held open while the offices load, so the row doesn't shift when they arrive. */}
        {showOffices &&
          (offices.data ? (
            <motion.div {...fade}>
              <Select
                value={filters.officeId}
                onChange={(event) => setParam("office", event.target.value)}
                aria-label={t("office")}
                className="w-44"
              >
                <option value="">{t("allOffices")}</option>
                {offices.data.data.map((office) => (
                  <option key={office.id} value={office.id}>
                    {office.name}
                  </option>
                ))}
              </Select>
            </motion.div>
          ) : (
            <Skeleton className="h-10 w-44 rounded-lg" />
          ))}
        <div className="flex-1" />
        <AnimatePresence initial={false}>
          {unassignable && (
            <motion.div key="unassigned" {...fade}>
              <Checkbox
                label={t("unassignedOnly")}
                checked={filters.unassigned}
                onChange={(event) => setParam("unassigned", event.target.checked ? "true" : "")}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Phones: one card per trip. */}
      <AutoHeight className="md:hidden">
        <ul
          aria-busy={trips.isFetching || undefined}
          className={cn("flex flex-col gap-3 transition-opacity", stale && "opacity-60")}
        >
          {trips.isPending ? (
            <TripCardsLoading />
          ) : trips.isError ? (
            <motion.li {...fade} className="py-10 text-center text-sm text-danger">
              {errorMessage(trips.error)}
            </motion.li>
          ) : rows.length === 0 ? (
            <motion.li {...fade} className="flex flex-col items-center gap-1.5 py-10 text-center">
              <span className="text-base font-semibold text-foreground">{t("empty")}</span>
              <span className="text-[0.8125rem] text-muted">{t("emptyHint")}</span>
            </motion.li>
          ) : (
            rows.map((trip) => <TripCard key={trip.id} trip={trip} />)
          )}
        </ul>
      </AutoHeight>

      <AutoHeight className="hidden md:block">
        <Table
          aria-busy={trips.isFetching || undefined}
          className={cn("transition-opacity", stale && "opacity-60")}
        >
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.code")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead>{t("columns.route")}</TableHead>
              <TableHead>{t("columns.pickup")}</TableHead>
              <TableHead>{t("columns.booker")}</TableHead>
              <TableHead>{t("columns.price")}</TableHead>
              <TableHead>{t("columns.assignment")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("columns.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trips.isPending ? (
              <TripRowsLoading />
            ) : trips.isError ? (
              <TableEmpty columns={COLUMNS} title={errorMessage(trips.error)} />
            ) : rows.length === 0 ? (
              <TableEmpty columns={COLUMNS} title={t("empty")} description={t("emptyHint")} />
            ) : (
              rows.map((trip) => <TripRow key={trip.id} trip={trip} />)
            )}
          </TableBody>
        </Table>
      </AutoHeight>

      <AnimatePresence initial={false}>
        {(pages.hasPrevious || trips.data?.nextCursor) && (
          <motion.div key="pages" {...fade}>
            <Pagination
              hasPrevious={pages.hasPrevious}
              hasNext={Boolean(trips.data?.nextCursor)}
              onPrevious={pages.previous}
              onNext={() => pages.next(trips.data?.nextCursor)}
              loading={trips.isFetching}
              summary={rows.length > 0 && t("showing", { first, last: first + rows.length - 1 })}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function TripRow({ trip }: { trip: Trip }) {
  const router = useRouter();

  return (
    <MotionTableRow
      {...fade}
      className="cursor-pointer hover:bg-surface-muted/50"
      onClick={() => router.push(`/trips/${trip.id}`)}
    >
      <TableCell>
        <Link
          href={`/trips/${trip.id}`}
          onClick={(event) => event.stopPropagation()}
          className="text-[0.8125rem] font-medium whitespace-nowrap text-primary hover:underline"
          dir="ltr"
        >
          {trip.code}
        </Link>
      </TableCell>
      <TableCell>
        <TripStatusBadge status={trip.status} />
      </TableCell>
      <TableCell className="min-w-56">
        <RouteCell trip={trip} />
      </TableCell>
      <TableCell>
        <WhenCell trip={trip} />
      </TableCell>
      <TableCell>
        <BookerCell trip={trip} />
      </TableCell>
      <TableCell>
        <TripPrice trip={trip} />
      </TableCell>
      <TableCell className="max-w-44">
        <TripAssignment trip={trip} />
      </TableCell>
      <TableCell className="w-11 px-2" onClick={(event) => event.stopPropagation()}>
        <RowMenu trip={trip} />
      </TableCell>
    </MotionTableRow>
  );
}

function RowMenu({ trip }: { trip: Trip }) {
  const t = useTranslations("staff.trips.list");
  const router = useRouter();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={t("rowActions", { code: trip.code })}
        >
          <IconDotsVertical aria-hidden className="size-4.5" stroke={1.75} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => router.push(`/trips/${trip.id}`)}>
          <IconEye aria-hidden className="size-4" stroke={1.75} />
          {t("open")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void navigator.clipboard
              .writeText(trip.code)
              .then(() => toast.success(t("copied", { code: trip.code })));
          }}
        >
          <IconCopy aria-hidden className="size-4" stroke={1.75} />
          {t("copyCode")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Searches as typing settles, without a request per key.
function SearchBox({ initial, onSearch }: { initial: string; onSearch: (q: string) => void }) {
  const t = useTranslations("staff.trips.list");
  const [value, setValue] = useState(initial);

  useEffect(() => {
    if (value.trim() === initial) return;
    const timer = setTimeout(() => onSearch(value.trim()), 300);
    return () => clearTimeout(timer);
  }, [value, initial, onSearch]);

  return (
    <Input
      type="search"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      placeholder={t("searchPlaceholder")}
      aria-label={t("search")}
      startAdornment={<IconSearch aria-hidden className="size-4.5" stroke={1.75} />}
      className="w-full sm:w-80"
    />
  );
}

function RouteCell({ trip }: { trip: Trip }) {
  const t = useTranslations("staff.trips");
  const name = useLocalName();

  return (
    <div className="flex min-w-0 flex-col">
      <span className="flex items-center gap-1.5 text-sm text-foreground">
        <span className="truncate">{name(trip.pickup)}</span>
        <DirectionalIcon icon={IconArrowRight} className="size-3.5 shrink-0 text-muted" />
        <span className="truncate">{name(trip.dropoff)}</span>
      </span>
      <span className="truncate text-xs text-muted">
        {t("list.routeDetail", {
          car: t(`car.${trip.car}`),
          class: name(trip.class),
          passengers: trip.passengers,
        })}
      </span>
    </div>
  );
}

function WhenCell({ trip }: { trip: Trip }) {
  const { day, time } = useTripDates();
  return (
    <div className="flex flex-col whitespace-nowrap">
      <span className="text-sm text-foreground">{day(trip.pickupDate)}</span>
      <span className="text-xs text-muted">{time(trip.pickupDate)}</span>
    </div>
  );
}

function BookerCell({ trip }: { trip: Trip }) {
  const t = useTranslations("staff.trips.booker");
  return (
    <div className="flex max-w-36 min-w-0 flex-col">
      <span className="truncate text-sm text-foreground">{trip.booker.name}</span>
      <span className="text-xs text-muted">{t(trip.booker.type)}</span>
    </div>
  );
}

function TripCard({ trip }: { trip: Trip }) {
  return (
    <motion.li {...fade}>
      <Link
        href={`/trips/${trip.id}`}
        className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-muted/50"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.8125rem] font-medium text-primary" dir="ltr">
            {trip.code}
          </span>
          <TripStatusBadge status={trip.status} />
        </div>
        <RouteCell trip={trip} />
        <div className="flex items-end justify-between gap-3">
          <WhenCell trip={trip} />
          <TripPrice trip={trip} />
        </div>
        <div className="border-t border-border pt-3">
          <TripAssignment trip={trip} />
        </div>
      </Link>
    </motion.li>
  );
}

// Two lines, like the cells they stand in for.
function Lines({ first, second }: { first: string; second?: string }) {
  return (
    <div className="flex flex-col gap-1.5 py-0.5">
      <Skeleton className={cn("h-3.5", first)} />
      {second && <Skeleton className={cn("h-3", second)} />}
    </div>
  );
}

// The first page loading: rows shaped like the trips they stand in for, so nothing moves when they arrive.
function TripRowsLoading() {
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
            <Skeleton className="h-3.5 w-22" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-5.5 w-24 rounded-full" />
          </TableCell>
          <TableCell className="min-w-56">
            <Lines first={row % 2 ? "w-48" : "w-40"} second="w-36" />
          </TableCell>
          <TableCell>
            <Lines first="w-20" second="w-12" />
          </TableCell>
          <TableCell>
            <Lines first="w-24" second="w-14" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-18" />
          </TableCell>
          <TableCell>
            <Lines first="w-28" second="w-20" />
          </TableCell>
          <TableCell className="w-11 px-2">
            <Skeleton className="size-8 rounded-lg" />
          </TableCell>
        </motion.tr>
      ))}
    </>
  );
}

function TripCardsLoading() {
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
            <Skeleton className="h-3.5 w-22" />
            <Skeleton className="h-5.5 w-24 rounded-full" />
          </div>
          <Lines first="w-48" second="w-36" />
          <div className="flex items-end justify-between">
            <Lines first="w-20" second="w-12" />
            <Skeleton className="h-3.5 w-18" />
          </div>
          <div className="border-t border-border pt-3">
            <Lines first="w-28" second="w-20" />
          </div>
        </motion.li>
      ))}
    </>
  );
}
