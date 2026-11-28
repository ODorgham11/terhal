"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconExternalLink, IconTrash } from "@tabler/icons-react";
import type { LocationDetail } from "@terhal/contracts";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Swap } from "@/components/ui/Motion";
import { Skeleton } from "@/components/ui/Skeleton";
import { Switch } from "@/components/ui/Switch";
import { toast } from "@/components/ui/Toast";
import { call, staffApi, useErrorMessage } from "@/lib/api";
import { ConfirmDialog } from "../ConfirmDialog";
import { InfoList, InfoRow } from "../SectionCard";
import { useLocalName } from "../trips/format";
import { LocationFields, useDraftErrors, type LocationDraft } from "./LocationFields";
import { locationsKey, mapLink, parseNumber, toKm, toMeters } from "./shared";

type Props = { id: string; onDeleted: () => void };

// The selected place: its names, parent, centre and radius. Governorates are only shown, since they come from the seed.
export function LocationEditor({ id, onDeleted }: Props) {
  const t = useTranslations("staff.locations");
  const detail = useQuery({
    queryKey: [...locationsKey, "detail", id],
    queryFn: () => call(staffApi.locations[":id"].$get({ param: { id } })),
  });
  return (
    <Swap state={detail.isPending ? "loading" : detail.isError ? "error" : "ready"}>
      {detail.isPending ? (
        <EditorLoading />
      ) : detail.isError ? (
        <Alert tone="danger" title={t("loadFailed")} />
      ) : (
        <Editor key={detail.dataUpdatedAt} location={detail.data} onDeleted={onDeleted} />
      )}
    </Swap>
  );
}

// The editor's own shape in gray: its header, then its fields.
function EditorLoading() {
  const t = useTranslations("common.ui");
  return (
    <div role="status" className="flex flex-col gap-5">
      <span className="sr-only">{t("loading")}</span>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5.5 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>
      <div className="grid gap-x-4 gap-y-6 sm:grid-cols-2">
        {[0, 1, 2, 3].map((field) => (
          <div key={field} className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ))}
      </div>
      <Skeleton className="h-3 w-64 max-w-full" />
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Skeleton className="h-10 w-20 rounded-lg" />
        <Skeleton className="h-10 w-20 rounded-lg" />
      </div>
    </div>
  );
}

const draftOf = (location: LocationDetail): LocationDraft => {
  const parent = location.ancestors.at(-1) ?? null;
  return {
    nameEn: location.nameEn,
    nameAr: location.nameAr,
    parent,
    latitude: location.center ? String(location.center.latitude) : "",
    longitude: location.center ? String(location.center.longitude) : "",
    radiusKm: location.center ? toKm(location.center.radius) : "",
  };
};

// Whether trips can go to the governorate as a whole. Applies at once, like the other switches.
function FlexibleSwitch({ location }: { location: LocationDetail }) {
  const t = useTranslations("staff.locations");
  const name = useLocalName();
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const [checked, setChecked] = useState(location.flexible);
  const [busy, setBusy] = useState(false);

  const toggle = async (flexible: boolean) => {
    setChecked(flexible);
    setBusy(true);
    try {
      await call(
        staffApi.locations[":id"].$patch({ param: { id: location.id }, json: { flexible } }),
      );
      await client.invalidateQueries({ queryKey: locationsKey });
      await client.invalidateQueries({ queryKey: ["staff", "locations", "pick"] });
      toast.success(t(flexible ? "flexibleOn" : "flexibleOff", { name: name(location) }));
    } catch (failure) {
      setChecked(!flexible);
      toast.error(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-border pt-4">
      <Switch
        label={t("flexible")}
        description={
          location.hasBoundary
            ? t("flexibleHint", { name: name(location) })
            : t("flexibleNoOutline")
        }
        checked={checked}
        disabled={busy || !location.hasBoundary}
        onChange={(event) => void toggle(event.target.checked)}
      />
    </div>
  );
}

function Editor({ location, onDeleted }: { location: LocationDetail; onDeleted: () => void }) {
  const t = useTranslations("staff.locations");
  const name = useLocalName();
  const errorMessage = useErrorMessage();
  const draftErrors = useDraftErrors();
  const client = useQueryClient();
  const [draft, setDraft] = useState(() => draftOf(location));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const governorate = location.locality === "GOVERNORATE";
  const errors = draftErrors(draft);
  const trail = [...location.ancestors.map((ancestor) => name(ancestor)), name(location)].join(
    " › ",
  );

  const save = async () => {
    setTried(true);
    if (Object.keys(errors).length > 0 || !draft.parent) return;
    setBusy(true);
    setError(null);
    try {
      await call(
        staffApi.locations[":id"].$patch({
          param: { id: location.id },
          json: {
            ...(draft.parent.id !== location.parentId && { parentId: draft.parent.id }),
            nameEn: draft.nameEn.trim(),
            nameAr: draft.nameAr.trim(),
            center: {
              latitude: parseNumber(draft.latitude) ?? 0,
              longitude: parseNumber(draft.longitude) ?? 0,
              radius: toMeters(parseNumber(draft.radiusKm) ?? 0),
            },
          },
        }),
      );
      await client.invalidateQueries({ queryKey: locationsKey });
      toast.success(t("saved"));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    await call(
      staffApi.locations[":id"].$delete({
        param: { id: location.id },
        query: { expectedCount: String(location.subtreeSize) },
      }),
    );
    await client.invalidateQueries({ queryKey: locationsKey });
    toast.success(t("deleted", { count: location.subtreeSize }));
    onDeleted();
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-lg font-semibold text-foreground">{name(location)}</h2>
          <p className="text-xs text-muted">
            {trail} · {t(`localities.${location.locality}`)}
          </p>
        </div>
        {!governorate && (
          <Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
            <IconTrash aria-hidden className="size-4" stroke={1.75} />
            {t("delete")}
          </Button>
        )}
      </header>

      {governorate ? (
        <>
          <p className="text-sm text-muted">{t("governorateReadOnly")}</p>
          <InfoList>
            <InfoRow label={t("englishName")}>{location.nameEn}</InfoRow>
            <InfoRow label={t("arabicName")}>{location.nameAr}</InfoRow>
            <InfoRow label={t("outline")}>{location.hasBoundary ? t("yes") : t("no")}</InfoRow>
            <InfoRow label={t("inside")}>
              {t("places", { count: location.subtreeSize - 1 })}
            </InfoRow>
          </InfoList>
          <FlexibleSwitch location={location} />
        </>
      ) : (
        <>
          {error && <Alert tone="danger" title={error} />}
          <LocationFields draft={draft} onChange={setDraft} errors={tried ? errors : {}} />
          {location.center && (
            <a
              href={mapLink(location.center.latitude, location.center.longitude)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline"
            >
              <IconExternalLink aria-hidden className="size-4" stroke={1.75} />
              {t("viewOnMap")}
            </a>
          )}
          <p className="text-xs text-muted">
            {t("usage", { offices: location.usage.offices, trips: location.usage.upcomingTrips })}
          </p>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" onClick={() => setDraft(draftOf(location))}>
              {t("discard")}
            </Button>
            <Button onClick={save} loading={busy}>
              {t("save")}
            </Button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("deleteTitle", { name: name(location) })}
        description={t("deleteDescription", {
          count: location.subtreeSize,
          offices: location.usage.offices,
          trips: location.usage.upcomingTrips,
        })}
        confirmLabel={t("delete")}
        tone="danger"
        onConfirm={remove}
      />
    </div>
  );
}
