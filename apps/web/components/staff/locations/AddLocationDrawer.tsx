"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { DEFAULT_RADIUS, type Location } from "@terhal/contracts";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Drawer, DrawerClose, DrawerContent } from "@/components/ui/Drawer";
import { toast } from "@/components/ui/Toast";
import { call, staffApi, useErrorMessage } from "@/lib/api";
import type { PickedLocation } from "../LocationPicker";
import { Segmented } from "../Segmented";
import { LocationFields, useDraftErrors, type LocationDraft } from "./LocationFields";
import { locationsKey, parseNumber, toKm, toMeters } from "./shared";

type Props = {
  // Where it goes, when added from a row's menu; the parent field starts on it.
  parent: PickedLocation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (location: Location) => void;
};

// A new district (in a governorate) or area (in a district or a governorate). Governorates come from the seed.
export function AddLocationDrawer({ parent, open, onOpenChange, onAdded }: Props) {
  const t = useTranslations("staff.locations.add");
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={t("title")}
        description={t("description")}
        className="max-w-xl"
        footer={
          <>
            <DrawerClose asChild>
              <Button variant="secondary">{t("cancel")}</Button>
            </DrawerClose>
            <Button type="submit" form="add-location-form">
              {t("submit")}
            </Button>
          </>
        }
      >
        {open && (
          <AddForm
            parent={parent}
            onAdded={(location) => {
              onOpenChange(false);
              onAdded(location);
            }}
          />
        )}
      </DrawerContent>
    </Drawer>
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
  const [error, setError] = useState<string | null>(null);
  const errors = draftErrors(draft);

  const save = async () => {
    setTried(true);
    if (Object.keys(errors).length > 0 || !draft.parent) return;
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
    }
  };

  return (
    <form
      id="add-location-form"
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
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
    </form>
  );
}
