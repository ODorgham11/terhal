"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconExternalLink } from "@tabler/icons-react";
import type { Location, LocationDetail } from "@terhal/contracts";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Drawer, DrawerClose, DrawerContent } from "@/components/ui/Drawer";
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

type Props = {
  // The row that was opened; its details load in the panel.
  location: Location | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// A place in a side panel: a district's or an area's names, parent, centre and radius to change, or a governorate's
// details and its whole-governorate switch (governorates come from the seed, so they're otherwise read only).
export function LocationDrawer({ location, open, onOpenChange }: Props) {
  const t = useTranslations("staff.locations");
  const name = useLocalName();
  const governorate = location?.locality === "GOVERNORATE";

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={location ? name(location) : ""}
        description={location ? t(`localities.${location.locality}`) : undefined}
        className="max-w-xl"
        footer={
          governorate ? (
            <DrawerClose asChild>
              <Button variant="secondary">{t("close")}</Button>
            </DrawerClose>
          ) : (
            <>
              <DrawerClose asChild>
                <Button variant="secondary">{t("add.cancel")}</Button>
              </DrawerClose>
              <Button type="submit" form="location-form">
                {t("save")}
              </Button>
            </>
          )
        }
      >
        {open && location && <Details id={location.id} onDone={() => onOpenChange(false)} />}
      </DrawerContent>
    </Drawer>
  );
}

function Details({ id, onDone }: { id: string; onDone: () => void }) {
  const t = useTranslations("staff.locations");
  const detail = useQuery({
    queryKey: [...locationsKey, "detail", id],
    queryFn: () => call(staffApi.locations[":id"].$get({ param: { id } })),
  });
  return (
    <Swap state={detail.isPending ? "loading" : detail.isError ? "error" : "ready"}>
      {detail.isPending ? (
        <DetailsLoading />
      ) : detail.isError ? (
        <Alert tone="danger" title={t("loadFailed")} />
      ) : detail.data.locality === "GOVERNORATE" ? (
        <Governorate location={detail.data} />
      ) : (
        <Editor key={detail.dataUpdatedAt} location={detail.data} onDone={onDone} />
      )}
    </Swap>
  );
}

// The fields in gray, so the panel doesn't jump when they arrive.
function DetailsLoading() {
  const t = useTranslations("common.ui");
  return (
    <div role="status" className="flex flex-col gap-6">
      <span className="sr-only">{t("loading")}</span>
      <Skeleton className="h-3.5 w-56" />
      <div className="grid gap-x-4 gap-y-6 sm:grid-cols-2">
        {[0, 1, 2, 3, 4, 5].map((field) => (
          <div key={field} className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ))}
      </div>
      <Skeleton className="h-3 w-64 max-w-full" />
    </div>
  );
}

// Where it sits: "Cairo › Nasr City".
function useTrail(location: LocationDetail) {
  const name = useLocalName();
  return location.ancestors.map((ancestor) => name(ancestor)).join(" › ");
}

function Governorate({ location }: { location: LocationDetail }) {
  const t = useTranslations("staff.locations");
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">{t("governorateReadOnly")}</p>
      <InfoList>
        <InfoRow label={t("englishName")}>{location.nameEn}</InfoRow>
        <InfoRow label={t("arabicName")}>{location.nameAr}</InfoRow>
        <InfoRow label={t("outline")}>{location.hasBoundary ? t("yes") : t("no")}</InfoRow>
        <InfoRow label={t("inside")}>{t("places", { count: location.subtreeSize - 1 })}</InfoRow>
      </InfoList>
      <FlexibleSwitch location={location} />
    </div>
  );
}

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
    <div className="border-t border-border pt-5">
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

const draftOf = (location: LocationDetail): LocationDraft => ({
  nameEn: location.nameEn,
  nameAr: location.nameAr,
  parent: location.ancestors.at(-1) ?? null,
  latitude: location.center ? String(location.center.latitude) : "",
  longitude: location.center ? String(location.center.longitude) : "",
  radiusKm: location.center ? toKm(location.center.radius) : "",
});

function Editor({ location, onDone }: { location: LocationDetail; onDone: () => void }) {
  const t = useTranslations("staff.locations");
  const name = useLocalName();
  const errorMessage = useErrorMessage();
  const draftErrors = useDraftErrors();
  const client = useQueryClient();
  const trail = useTrail(location);
  const [draft, setDraft] = useState(() => draftOf(location));
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const errors = draftErrors(draft);

  const save = async () => {
    setTried(true);
    if (Object.keys(errors).length > 0 || !draft.parent) return;
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
      onDone();
    } catch (failure) {
      setError(errorMessage(failure));
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
    onDone();
  };

  return (
    <form
      id="location-form"
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {trail && <p className="-mt-2 text-xs text-muted">{trail}</p>}
      {error && <Alert tone="danger" title={error} />}
      <LocationFields draft={draft} onChange={setDraft} errors={tried ? errors : {}} />
      <div className="flex flex-col gap-2">
        {location.center && (
          <a
            href={mapLink(location.center.latitude, location.center.longitude)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-primary transition-colors duration-200 hover:text-primary-hover"
          >
            <IconExternalLink aria-hidden className="size-4" stroke={1.75} />
            {t("viewOnMap")}
          </a>
        )}
        <p className="text-xs text-muted">
          {t("usage", { offices: location.usage.offices, trips: location.usage.upcomingTrips })}
        </p>
      </div>

      <section className="flex flex-col items-start gap-2 rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">{t("deleteSection")}</h3>
        <p className="text-sm text-muted">{t("deleteSectionHint")}</p>
        <Button type="button" variant="secondary" size="sm" onClick={() => setDeleting(true)}>
          {t("delete")}
        </Button>
      </section>

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
    </form>
  );
}
