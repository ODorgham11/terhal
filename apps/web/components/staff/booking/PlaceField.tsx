"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { TripPin } from "@terhal/contracts";
import { Input } from "@/components/ui/Input";
import { call, staffApi } from "@/lib/api";
import { toLatinDigits } from "@/lib/digits";
import { LocationPicker, type PickedLocation } from "../LocationPicker";

export type Place = { label: PickedLocation; pin: TripPin };

type Props = {
  value: Place | null;
  onChange: (place: Place | null) => void;
  invalid?: boolean;
};

// A trip end: a district or area (its centre becomes the pin), the whole of a flexible governorate (booked by name, its
// outline's centre as the pin), or exact coordinates pasted from a map.
export function PlaceField({ value, onChange, invalid }: Props) {
  const t = useTranslations("staff.booking.place");
  const [error, setError] = useState<string | null>(null);
  const [exact, setExact] = useState(false);
  const [coordinates, setCoordinates] = useState("");

  const pick = async (location: PickedLocation | null) => {
    setError(null);
    if (!location) return onChange(null);
    const detail = await call(staffApi.locations[":id"].$get({ param: { id: location.id } }));
    if (detail.flexible && detail.pin) {
      return onChange({ label: location, pin: { ...detail.pin, locationId: detail.id } });
    }
    if (!detail.center) {
      setError(t("needsCentre"));
      return onChange(null);
    }
    onChange({
      label: location,
      pin: { latitude: detail.center.latitude, longitude: detail.center.longitude },
    });
  };

  const typed = (text: string) => {
    setCoordinates(text);
    const match = /^\s*(-?\d+(?:\.\d+)?)\s*[,،\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(
      toLatinDigits(text),
    );
    if (!match || !value) return;
    // A whole governorate stays booked by name; the pasted spot only moves its pin.
    onChange({
      ...value,
      pin: { ...value.pin, latitude: Number(match[1]), longitude: Number(match[2]) },
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <LocationPicker
        value={value?.label ?? null}
        onChange={(location) => void pick(location)}
        invalid={invalid || !!error}
        bookable
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      {value && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted" dir="ltr">
            {value.pin.latitude.toFixed(5)}, {value.pin.longitude.toFixed(5)}{" "}
            <button
              type="button"
              onClick={() => setExact(!exact)}
              className="text-primary hover:underline"
            >
              {exact ? t("useCentre") : t("exact")}
            </button>
          </p>
          {exact && (
            <Input
              dir="ltr"
              inputMode="decimal"
              autoComplete="off"
              placeholder="30.0084, 31.4913"
              aria-label={t("coordinates")}
              value={coordinates}
              onChange={(event) => typed(event.target.value)}
            />
          )}
        </div>
      )}
    </div>
  );
}
