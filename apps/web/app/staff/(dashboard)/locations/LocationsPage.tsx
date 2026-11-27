"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconPlus, IconRestore } from "@tabler/icons-react";
import type { Location } from "@terhal/contracts";
import { RequireStaff } from "@/components/session/RequireSession";
import type { PickedLocation } from "@/components/staff/LocationPicker";
import { SearchBox } from "@/components/staff/SearchBox";
import { AddLocationDialog } from "@/components/staff/locations/AddLocationDialog";
import { LocationEditor } from "@/components/staff/locations/LocationEditor";
import { LocationTree } from "@/components/staff/locations/LocationTree";
import { locationsKey } from "@/components/staff/locations/shared";
import { useLocalName } from "@/components/staff/trips/format";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { toast } from "@/components/ui/Toast";
import { call, staffApi, useErrorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

export function LocationsPage() {
  return <RequireStaff permission="pricing">{() => <Locations />}</RequireStaff>;
}

type Tab = "live" | "deleted";

function Locations() {
  const t = useTranslations("staff.locations");
  const [tab, setTab] = useState<Tab>("live");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<PickedLocation | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button onClick={() => setAdding(true)}>
            <IconPlus aria-hidden className="size-5" stroke={1.75} />
            {t("addLocation")}
          </Button>
        }
      />
      <div className="grid items-start gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-3">
          <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
            <TabsList>
              <TabsTrigger value="live">{t("live")}</TabsTrigger>
              <TabsTrigger value="deleted">{t("deletedTab")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <SearchBox initial={q} onSearch={setQ} placeholder={t("search")} className="sm:w-full" />
          <div className="max-h-[36rem] overflow-y-auto">
            {tab === "deleted" ? (
              <FlatList q={q} deleted selectedId={null} onSelect={() => undefined} />
            ) : q ? (
              <FlatList
                q={q}
                deleted={false}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
              />
            ) : (
              <LocationTree selectedId={selected?.id ?? null} onSelect={setSelected} />
            )}
          </div>
        </aside>
        <section className="rounded-2xl border border-border bg-surface p-5">
          {selected ? (
            <LocationEditor
              key={selected.id}
              id={selected.id}
              onDeleted={() => setSelected(null)}
            />
          ) : (
            <p className="py-16 text-center text-sm text-muted">{t("pick")}</p>
          )}
        </section>
      </div>
      <AddLocationDialog
        parent={selected}
        open={adding}
        onOpenChange={setAdding}
        onAdded={setSelected}
      />
    </>
  );
}

// Search results, or deleted places with a restore button on the ones that were deleted directly.
function FlatList({
  q,
  deleted,
  selectedId,
  onSelect,
}: {
  q: string;
  deleted: boolean;
  selectedId: string | null;
  onSelect: (location: Location) => void;
}) {
  const t = useTranslations("staff.locations");
  const name = useLocalName();
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

  if (results.isPending) return <Skeleton className="h-40 w-full" />;
  if (results.isError)
    return <p className="p-2 text-sm text-danger">{errorMessage(results.error)}</p>;
  if (results.data.data.length === 0) {
    return (
      <p className="p-4 text-center text-sm text-muted">
        {deleted ? t("noneDeleted") : t("noResults")}
      </p>
    );
  }
  return (
    <ul className="flex flex-col">
      {results.data.data.map((location) => (
        <li key={location.id}>
          <div
            className={cn(
              "flex h-10 items-center gap-2 rounded-lg px-2 text-sm",
              location.id === selectedId
                ? "bg-primary-soft font-medium text-primary"
                : "hover:bg-surface-muted",
            )}
          >
            <button
              type="button"
              disabled={deleted}
              onClick={() => onSelect(location)}
              className="min-w-0 flex-1 truncate text-start disabled:cursor-default"
            >
              {name(location)}
            </button>
            <span className="shrink-0 text-xs font-normal text-muted">
              {t(`localities.${location.locality}`)}
            </span>
            {deleted && location.deletedWithId === location.id && (
              <Button variant="ghost" size="sm" onClick={() => void restore(location)}>
                <IconRestore aria-hidden className="size-4" stroke={1.75} />
                {t("restore")}
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
