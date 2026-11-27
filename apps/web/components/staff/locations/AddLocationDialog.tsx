"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { DEFAULT_RADIUS, type Location } from "@terhal/contracts";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/Dialog";
import { toast } from "@/components/ui/Toast";
import { call, staffApi, useErrorMessage } from "@/lib/api";
import type { PickedLocation } from "../LocationPicker";
import { Segmented } from "../Segmented";
import { LocationFields, useDraftErrors, type LocationDraft } from "./LocationFields";
import { locationsKey, parseNumber, toKm, toMeters } from "./shared";

type Props = {
  // The place selected in the tree, offered as the parent.
  parent: PickedLocation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (location: Location) => void;
};

// A new district (in a governorate) or area (in a district or a governorate). Governorates come from the seed.
export function AddLocationDialog({ parent, open, onOpenChange, onAdded }: Props) {
  const t = useTranslations("staff.locations.add");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("title")} description={t("description")} className="max-w-xl">
        {open && (
          <AddForm
            parent={parent}
            onAdded={(location) => {
              onOpenChange(false);
              onAdded(location);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddForm({
  parent,
  onAdded,
}: {
  parent: PickedLocation | null;
  onAdded: (location: Location) => void;
}) {
  const t = useTranslations("staff.locations.add");
  const localities = useTranslations("staff.locations.localities");
  const errorMessage = useErrorMessage();
  const draftErrors = useDraftErrors();
  const client = useQueryClient();
  const [locality, setLocality] = useState<"DISTRICT" | "AREA">(
    parent?.locality === "GOVERNORATE" ? "DISTRICT" : "AREA",
  );
  const [draft, setDraft] = useState<LocationDraft>({
    nameEn: "",
    nameAr: "",
    parent: parent?.locality === "AREA" ? null : parent,
    latitude: "",
    longitude: "",
    radiusKm: toKm(DEFAULT_RADIUS),
  });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = draftErrors(draft);

  const save = async () => {
    setTried(true);
    if (Object.keys(errors).length > 0 || !draft.parent) return;
    setBusy(true);
    setError(null);
    try {
      const created = await call(
        staffApi.locations.$post({
          json: {
            locality,
            parentId: draft.parent.id,
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
      toast.success(t("added"));
      onAdded(created);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="danger" title={error} />}
      <Segmented
        label={t("kind")}
        value={locality}
        onChange={setLocality}
        options={[
          { value: "DISTRICT", label: localities("DISTRICT") },
          { value: "AREA", label: localities("AREA") },
        ]}
      />
      <LocationFields draft={draft} onChange={setDraft} errors={tried ? errors : {}} />
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">{t("cancel")}</Button>
        </DialogClose>
        <Button onClick={save} loading={busy}>
          {t("submit")}
        </Button>
      </DialogFooter>
    </div>
  );
}
