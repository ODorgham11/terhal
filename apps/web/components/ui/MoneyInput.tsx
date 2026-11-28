"use client";

import type { ComponentProps } from "react";
import { toLatinDigits } from "@/lib/digits";
import { Input } from "./Input";

// An amount in pounds, with "EGP" inside the box at the inline start. Works with register() as is. Arabic-Indic digits
// become Latin ones and a minus sign never goes in: prices and fees are never negative.
export function MoneyInput({
  onChange,
  ...props
}: Omit<ComponentProps<typeof Input>, "type" | "startAdornment" | "inputMode">) {
  return (
    <Input
      inputMode="decimal"
      autoComplete="off"
      {...props}
      startAdornment={<span className="text-xs font-medium">EGP</span>}
      inputClassName="ps-12 tabular-nums"
      onChange={(event) => {
        const clean = toLatinDigits(event.target.value).replace(/[-−]/g, "");
        if (clean !== event.target.value) event.target.value = clean;
        onChange?.(event);
      }}
    />
  );
}
