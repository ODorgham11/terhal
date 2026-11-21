"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { toLatinDigits } from "@/lib/digits";
import { Input } from "./Input";

// A phone number field. Works with register("phone") as is. People type numbers however they write them (01001234567,
// +20 100 123 4567, Arabic-Indic digits); the contracts' Phone schema turns any of those into +201001234567, so this
// only converts the digits and leaves the rest to it.
export function PhoneInput({
  onChange,
  className,
  ...props
}: Omit<ComponentProps<"input">, "type">) {
  return (
    <Input
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder="01X XXXX XXXX"
      {...props}
      // A number always reads left to right. The input itself is dir="ltr", so on an Arabic page (rtl: matches the
      // page, not the input) text-end is its right edge, lining the number up with the other fields.
      dir="ltr"
      className={cn("rtl:text-end", className)}
      onChange={(event) => {
        const latin = toLatinDigits(event.target.value);
        if (latin !== event.target.value) event.target.value = latin;
        onChange?.(event);
      }}
    />
  );
}
