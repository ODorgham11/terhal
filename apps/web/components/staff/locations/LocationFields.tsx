"use client";

import { useTranslations } from "next-intl";
import { MAX_RADIUS } from "@terhal/contracts";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { LocationPicker, type PickedLocation } from "../LocationPicker";
import { parseNumber } from "./shared";

export type LocationDraft = {
  nameEn: string;
  nameAr: string;
  parent: PickedLocation | null;
  latitude: string;
  longitude: string;
  radiusKm: string;
};

// What's wrong with a draft, by field; empty when it can be sent.
export function useDraftErrors() {
  const t = useTranslations("staff.locations.errors");
  return (draft: LocationDraft) => {
    const errors: Partial<Record<keyof LocationDraft, string>> = {};
    if (draft.nameEn.trim().length < 2) errors.nameEn = t("name");
    if (draft.nameAr.trim().length < 2) errors.nameAr = t("name");
    if (!draft.parent) errors.parent = t("parent");
    const latitude = parseNumber(draft.latitude);
    const longitude = parseNumber(draft.longitude);
    const radius = parseNumber(draft.radiusKm);
    if (latitude === null || Math.abs(latitude) > 90) errors.latitude = t("latitude");
    if (longitude === null || Math.abs(longitude) > 180) errors.longitude = t("longitude");
    if (radius === null || radius < 0.1 || radius > MAX_RADIUS / 1000)
      errors.radiusKm = t("radius");
    return errors;
  };
}

type Props = {
  draft: LocationDraft;
  onChange: (draft: LocationDraft) => void;
  // Shown only once the person tries to save.
  errors: Partial<Record<keyof LocationDraft, string>>;
};

// Names, parent, centre and radius: the same fields to add a place or change one.
export function LocationFields({ draft, onChange, errors }: Props) {
  const t = useTranslations("staff.locations");
  const fields = useTranslations("common.fields");
  const set = <K extends keyof LocationDraft>(key: K, value: LocationDraft[K]) =>
    onChange({ ...draft, [key]: value });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={fields("nameEn")} error={errors.nameEn}>
        <Input
          dir="ltr"
          autoComplete="off"
          value={draft.nameEn}
          onChange={(event) => set("nameEn", event.target.value)}
        />
      </Field>
      <Field label={fields("nameAr")} error={errors.nameAr}>
        <Input
          dir="rtl"
          autoComplete="off"
          value={draft.nameAr}
          onChange={(event) => set("nameAr", event.target.value)}
        />
      </Field>
      <Field label={t("parent")} error={errors.parent} hint={t("parentHint")}>
        <LocationPicker
          value={draft.parent}
          onChange={(parent) => set("parent", parent)}
          invalid={!!errors.parent}
        />
      </Field>
      <Field label={t("radius")} error={errors.radiusKm} hint={t("radiusHint")}>
        <Input
          inputMode="decimal"
          autoComplete="off"
          value={draft.radiusKm}
          onChange={(event) => set("radiusKm", event.target.value)}
          endAdornment={<span className="text-xs">{t("km")}</span>}
        />
      </Field>
      <Field label={t("latitude")} error={errors.latitude}>
        <Input
          inputMode="decimal"
          dir="ltr"
          autoComplete="off"
          value={draft.latitude}
          onChange={(event) => set("latitude", event.target.value)}
        />
      </Field>
      <Field label={t("longitude")} error={errors.longitude}>
        <Input
          inputMode="decimal"
          dir="ltr"
          autoComplete="off"
          value={draft.longitude}
          onChange={(event) => set("longitude", event.target.value)}
        />
      </Field>
    </div>
  );
}
