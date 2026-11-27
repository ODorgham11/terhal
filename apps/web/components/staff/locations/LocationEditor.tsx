"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconExternalLink, IconTrash } from "@tabler/icons-react";
import type { LocationDetail } from "@terhal/contracts";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
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
  if (detail.isPending) return <Skeleton className="h-96 w-full" />;
  if (detail.isError) return <Alert tone="danger" title={t("loadFailed")} />;
  return <Editor key={detail.dataUpdatedAt} location={detail.data} onDeleted={onDeleted} />;
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
