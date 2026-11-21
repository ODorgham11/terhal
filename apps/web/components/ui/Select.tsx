"use client";

import type { ComponentProps } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { cn } from "@/lib/cn";
import { controlClasses, useFieldControl } from "./Field";

type SelectProps = ComponentProps<"select"> & {
  // A first, empty option ("Choose a class"), selected while there's no value.
  placeholder?: string;
};

// The native <select>: the platform's own picker on phones, full keyboard and screen reader support, works with
// register() as is. The arrow sits at the inline end, so it follows the direction.
export function Select({ placeholder, className, children, ...props }: SelectProps) {
  return (
    <div className={cn("relative", className)}>
      <select
        {...props}
        {...useFieldControl(props)}
        className={cn(controlClasses, "h-10 appearance-none pe-9")}
      >
        {placeholder !== undefined && (
          <option value="" disabled={props.required}>
            {placeholder}
          </option>
        )}
        {children}
      </select>
      <IconChevronDown
        aria-hidden
        className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted"
      />
    </div>
  );
}
