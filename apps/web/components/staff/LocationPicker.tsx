"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { IconMapPin, IconX } from "@tabler/icons-react";
import type { Locality } from "@terhal/contracts";
import { Input } from "@/components/ui/Input";
import { call, staffApi } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useLocalName } from "./trips/format";

export type PickedLocation = { id: string; nameEn: string; nameAr: string; locality?: Locality };

type LocationPickerProps = {
  value: PickedLocation | null;
  onChange: (location: PickedLocation | null) => void;
  placeholder?: string;
  invalid?: boolean;
  id?: string;
  // Only places a trip can go to: districts, areas and flexible governorates.
  bookable?: boolean;
};

// Search the locations (governorates, districts, areas) and pick one: a combobox, so arrow keys and Enter work.
export function LocationPicker({
  value,
  onChange,
  placeholder,
  invalid,
  id,
  bookable = false,
}: LocationPickerProps) {
  const t = useTranslations("staff.locationPicker");
  const localities = useTranslations("staff.locations.localities");
  const places = useTranslations("staff.locations");
  const name = useLocalName();
  const listId = useId();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const results = useQuery({
    queryKey: ["staff", "locations", "pick", q, bookable],
    queryFn: () =>
      call(
        staffApi.locations.$get({
          query: { q, limit: "10", ...(bookable && { bookable: "true" as const }) },
        }),
      ),
    enabled: open && q.length >= 1,
    staleTime: 60_000,
  });
  const options = results.data?.data ?? [];

  const pick = (location: PickedLocation) => {
    onChange(location);
    setText("");
    setOpen(false);
  };

  if (value) {
    return (
      <div
        className={cn(
          "flex h-10 items-center gap-2 rounded-lg border bg-surface px-3 text-sm",
          invalid ? "border-danger" : "border-input",
        )}
      >
        <IconMapPin aria-hidden className="size-4.5 shrink-0 text-muted" stroke={1.75} />
        <span className="min-w-0 flex-1 truncate text-foreground">{name(value)}</span>
        {value.locality && <span className="text-xs text-muted">{localities(value.locality)}</span>}
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={t("clear")}
          className="rounded p-0.5 text-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <IconX aria-hidden className="size-4" stroke={1.75} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open && q.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        autoComplete="off"
        value={text}
        placeholder={placeholder ?? t("placeholder")}
        startAdornment={<IconMapPin aria-hidden className="size-4.5" stroke={1.75} />}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, options.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && options[active]) {
            event.preventDefault();
            pick(options[active]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && q.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          {results.isPending ? (
            <li className="px-3 py-2 text-sm text-muted">{t("searching")}</li>
          ) : options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">{t("noResults")}</li>
          ) : (
            options.map((location, index) => (
              <li
                key={location.id}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(location);
                }}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-sm",
                  index === active ? "bg-surface-muted" : "",
                )}
              >
                <span className="truncate text-foreground">{name(location)}</span>
                <span className="shrink-0 text-xs text-muted">
                  {location.flexible ? places("wholeGovernorate") : localities(location.locality)}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
