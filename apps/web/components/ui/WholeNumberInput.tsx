"use client";

import type { ComponentProps } from "react";
import { toLatinDigits } from "@/lib/digits";
import { Input } from "./Input";

// A count, a year, a position: digits only, so a minus sign, a decimal point or a letter never goes in. Arabic-Indic
// digits become Latin ones. Works with register() as is.
export function WholeNumberInput({
  onChange,
  ...props
}: Omit<ComponentProps<typeof Input>, "type" | "inputMode">) {
  return (
    <Input
      inputMode="numeric"
      autoComplete="off"
      {...props}
      onChange={(event) => {
        const digits = toLatinDigits(event.target.value).replace(/\D/g, "");
        if (digits !== event.target.value) event.target.value = digits;
        onChange?.(event);
      }}
    />
  );
}
