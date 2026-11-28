"use client";

import { useEffect, useMemo, useRef, useState, type ComponentType, type Ref } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Popover } from "radix-ui";
import EG from "country-flag-icons/react/3x2/EG";
import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/min";
import { IconCheck, IconChevronDown, IconSearch } from "@tabler/icons-react";
import { cn } from "@/lib/cn";
import { toLatinDigits } from "@/lib/digits";
import { useFieldControl } from "./Field";

type FlagComponent = ComponentType<{ title?: string; className?: string }>;

// Every other flag loads only when someone opens the country list, so a form that's Egypt only never ships them.
let allFlags: Record<string, FlagComponent> | null = null;
const loadFlags = () =>
  import("country-flag-icons/react/3x2").then((module) => {
    allFlags = module as unknown as Record<string, FlagComponent>;
    return allFlags;
  });

function Flag({ country, className }: { country: CountryCode; className?: string }) {
  const [, rerender] = useState(0);
  useEffect(() => {
    if (country !== "EG" && !allFlags) void loadFlags().then(() => rerender((n) => n + 1));
  }, [country]);
  const Component = country === "EG" ? EG : allFlags?.[country];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-3.5 w-5 shrink-0 overflow-hidden rounded-[3px] bg-surface-muted shadow-[0_0_0_1px_var(--border)]",
        className,
      )}
    >
      {Component && <Component className="size-full object-cover" />}
    </span>
  );
}

const DEFAULT: CountryCode = "EG";

// The country and the national digits a stored value holds: "+201001234567" is Egypt, "1001234567".
const split = (
  value: string,
  fallback: CountryCode,
): { country: CountryCode; national: string } => {
  const latin = toLatinDigits(value).replace(/[\s\-()]/g, "");
  if (!latin) return { country: fallback, national: "" };
  if (!latin.startsWith("+") && !latin.startsWith("00"))
    return { country: fallback, national: latin };
  const international = latin.startsWith("00") ? `+${latin.slice(2)}` : latin;
  const parsed = parsePhoneNumberFromString(international);
  if (parsed?.country) return { country: parsed.country, national: parsed.nationalNumber };
  // Not a whole number yet: match the longest calling code it starts with.
  const digits = international.slice(1);
  const match = getCountries()
    .map((country) => ({ country, code: getCountryCallingCode(country) }))
    .filter(({ code }) => digits.startsWith(code))
    .sort((a, b) => b.code.length - a.code.length)[0];
  return match
    ? { country: match.country, national: digits.slice(match.code.length) }
    : { country: fallback, national: digits };
};

// What goes out: "+" and the calling code, then the national digits without their trunk 0 (01001234567 → +201001234567).
// Empty when no digits are typed, so an optional phone stays optional.
const join = (country: CountryCode, national: string) => {
  const digits = toLatinDigits(national).replace(/\D/g, "").replace(/^0+/, "");
  return digits ? `+${getCountryCallingCode(country)}${digits}` : "";
};

type PhoneInputProps = {
  value: string | undefined | null;
  onChange: (value: string) => void;
  onBlur?: () => void;
  // "EG" (the default) fixes the country to Egypt; "all" adds a country list in front of the number.
  countries?: "EG" | "all";
  name?: string;
  id?: string;
  disabled?: boolean;
  autoComplete?: string;
  className?: string;
  ref?: Ref<HTMLInputElement>;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

// A phone number: the country's flag and calling code, then the number as people write it (with or without the 0,
// Arabic-Indic digits, spaces). The value is always international (+201001234567), which the contracts' Phone schema
// accepts as is. Controlled, so in a form wrap it in a Controller:
//
//   <Controller control={form.control} name="phone" render={({ field }) => <PhoneInput {...field} />} />
export function PhoneInput({
  value,
  onChange,
  onBlur,
  countries = "EG",
  name,
  disabled,
  autoComplete = "tel-national",
  className,
  ref,
  ...props
}: PhoneInputProps) {
  const field = useFieldControl(props);
  const [state, setState] = useState(() => split(value ?? "", DEFAULT));
  const emitted = useRef(value ?? "");

  // A new value from outside (a form reset, a picked customer) replaces what's shown.
  useEffect(() => {
    if ((value ?? "") === emitted.current) return;
    emitted.current = value ?? "";
    setState(split(value ?? "", countries === "EG" ? "EG" : state.country));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the value changes
  }, [value]);

  const country = countries === "EG" ? "EG" : state.country;
  const update = (next: { country: CountryCode; national: string }) => {
    setState(next);
    const joined = join(next.country, next.national);
    emitted.current = joined;
    onChange(joined);
  };

  const display = useMemo(() => {
    // Formatted as it's typed (100 123 4567), unless it holds something formatting would drop.
    const typed = toLatinDigits(state.national);
    if (/[^\d\s]/.test(typed)) return typed;
    return new AsYouType(country).input(typed);
  }, [state.national, country]);

  return (
    <div
      dir="ltr"
      className={cn(
        "flex h-10 w-full items-center rounded-lg border border-input bg-surface text-sm transition-colors",
        "focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25",
        "has-aria-invalid:border-danger has-aria-invalid:focus-within:ring-danger/25",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      {countries === "all" ? (
        <CountrySelect
          value={country}
          disabled={disabled}
          onChange={(next) => update({ country: next, national: state.national })}
        />
      ) : (
        <span className="flex h-full shrink-0 items-center gap-2 border-e border-input ps-3 pe-2.5 text-muted">
          <Flag country="EG" />
          <span className="tabular-nums">+20</span>
        </span>
      )}
      <input
        ref={ref}
        type="tel"
        inputMode="tel"
        name={name}
        autoComplete={autoComplete}
        disabled={disabled}
        placeholder={country === "EG" ? "10 0123 4567" : undefined}
        {...field}
        value={display}
        onBlur={onBlur}
        onChange={(event) => {
          let typed = toLatinDigits(event.target.value);
          // A whole international number pasted in: take its country from it.
          if (countries === "all" && (typed.startsWith("+") || typed.startsWith("00"))) {
            return update(split(typed, country));
          }
          if (countries === "EG") typed = typed.replace(/^\+?20(?=\d{9,})/, "");
          update({ country, national: typed.replace(/[^\d\s\-()]/g, "") });
        }}
        className="h-full min-w-0 flex-1 bg-transparent px-3 text-foreground tabular-nums placeholder:text-muted focus:outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
}

function CountrySelect({
  value,
  onChange,
  disabled,
}: {
  value: CountryCode;
  onChange: (country: CountryCode) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("common.ui");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [, rerender] = useState(0);

  const names = useMemo(() => new Intl.DisplayNames([locale], { type: "region" }), [locale]);
  const list = useMemo(
    () =>
      getCountries()
        .map((country) => ({
          country,
          name: names.of(country) ?? country,
          code: getCountryCallingCode(country),
        }))
        .sort((a, b) =>
          a.country === "EG" ? -1 : b.country === "EG" ? 1 : a.name.localeCompare(b.name, locale),
        ),
    [names, locale],
  );
  const needle = q.trim().toLowerCase().replace(/^\+/, "");
  const shown = needle
    ? list.filter(
        (item) =>
          item.name.toLowerCase().includes(needle) ||
          item.code.startsWith(needle) ||
          item.country.toLowerCase() === needle,
      )
    : list;

  useEffect(() => {
    if (open && !allFlags) void loadFlags().then(() => rerender((n) => n + 1));
  }, [open]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        type="button"
        disabled={disabled}
        aria-label={t("country", { country: names.of(value) ?? value })}
        className="flex h-full shrink-0 items-center gap-1.5 rounded-s-lg border-e border-input ps-3 pe-2 text-foreground transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
      >
        <Flag country={value} />
        <span className="text-muted tabular-nums">+{getCountryCallingCode(value)}</span>
        <IconChevronDown aria-hidden className="size-3.5 text-muted" stroke={1.75} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="animate-pop z-50 flex w-72 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).querySelector("input")?.focus();
          }}
        >
          <div className="flex items-center gap-2 border-b border-border px-3">
            <IconSearch aria-hidden className="size-4 text-muted" stroke={1.75} />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder={t("searchCountries")}
              aria-label={t("searchCountries")}
              className="h-10 min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none"
            />
          </div>
          <ul
            role="listbox"
            aria-label={t("searchCountries")}
            className="max-h-64 overflow-y-auto p-1"
          >
            {shown.map((item) => (
              <li key={item.country} role="option" aria-selected={item.country === value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(item.country);
                    setOpen(false);
                    setQ("");
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-sm text-foreground hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
                >
                  <Flag country={item.country} />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="text-xs text-muted tabular-nums" dir="ltr">
                    +{item.code}
                  </span>
                  {item.country === value && (
                    <IconCheck aria-hidden className="size-4 text-primary" stroke={2} />
                  )}
                </button>
              </li>
            ))}
            {shown.length === 0 && (
              <li className="px-2.5 py-6 text-center text-sm text-muted">{t("noResults")}</li>
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
