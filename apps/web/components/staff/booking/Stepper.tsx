"use client";

import { useTranslations } from "next-intl";
import { IconMinus, IconPlus } from "@tabler/icons-react";

type Props = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
};

// A count with minus and plus buttons; the number between them can be typed too.
export function Stepper({ label, value, onChange, min = 0, max = 50 }: Props) {
  const t = useTranslations("staff.booking");
  const set = (next: number) => onChange(Math.min(max, Math.max(min, next)));
  const button =
    "grid size-8 place-items-center rounded-md text-muted hover:bg-surface-muted hover:text-foreground disabled:opacity-40";
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <div className="flex h-10 items-center justify-between rounded-lg border border-input bg-surface px-1">
        <button
          type="button"
          className={button}
          onClick={() => set(value - 1)}
          disabled={value <= min}
          aria-label={t("less", { what: label })}
        >
          <IconMinus aria-hidden className="size-4" stroke={1.75} />
        </button>
        <input
          aria-label={label}
          inputMode="numeric"
          value={value}
          onChange={(event) => set(Number(event.target.value.replace(/\D/g, "")) || 0)}
          className="w-10 bg-transparent text-center text-sm tabular-nums outline-none"
        />
        <button
          type="button"
          className={button}
          onClick={() => set(value + 1)}
          disabled={value >= max}
          aria-label={t("more", { what: label })}
        >
          <IconPlus aria-hidden className="size-4" stroke={1.75} />
        </button>
      </div>
    </div>
  );
}
