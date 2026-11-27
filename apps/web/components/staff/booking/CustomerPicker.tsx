"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { IconSearch, IconX } from "@tabler/icons-react";
import type { CustomerDetail } from "@terhal/contracts";
import { Input } from "@/components/ui/Input";
import { call, staffApi } from "@/lib/api";
import { cn } from "@/lib/cn";
import { displayPhone } from "../fleet/format";

type Props = {
  value: CustomerDetail | null;
  onChange: (customer: CustomerDetail | null) => void;
  invalid?: boolean;
};

// Search active customers by name, phone or email and pick one: a combobox like the location picker.
export function CustomerPicker({ value, onChange, invalid }: Props) {
  const t = useTranslations("staff.booking.customer");
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
    queryKey: ["staff", "customers", "pick", q],
    queryFn: () => call(staffApi.customers.$get({ query: { q, status: "ACTIVE", limit: "8" } })),
    enabled: open && q.length >= 2,
    staleTime: 60_000,
  });
  const options = results.data?.data ?? [];
  const pick = (customer: CustomerDetail) => {
    onChange(customer);
    setText("");
    setOpen(false);
  };

  if (value) {
    return (
      <div className="flex h-10 items-center gap-2 rounded-lg border border-input bg-surface px-3 text-sm">
        <IconSearch aria-hidden className="size-4.5 shrink-0 text-muted" stroke={1.75} />
        <span className="min-w-0 flex-1 truncate text-foreground">
          {value.firstName} {value.lastName} ·{" "}
          <span dir="ltr" className="text-muted">
            {displayPhone(value.phone)}
          </span>
        </span>
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

  const showing = open && q.length >= 2;
  return (
    <div className="relative">
      <Input
        role="combobox"
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        autoComplete="off"
        value={text}
        placeholder={t("placeholder")}
        startAdornment={<IconSearch aria-hidden className="size-4.5" stroke={1.75} />}
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
          } else if (event.key === "Escape") setOpen(false);
        }}
      />
      {showing && (
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
            options.map((customer, index) => (
              <li
                key={customer.id}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(customer);
                }}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  "flex cursor-pointer flex-col rounded-md px-3 py-2 text-sm",
                  index === active && "bg-surface-muted",
                )}
              >
                <span className="text-foreground">
                  {customer.firstName} {customer.lastName}
                </span>
                <span className="text-xs text-muted" dir="ltr">
                  {displayPhone(customer.phone)} · {customer.email}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
