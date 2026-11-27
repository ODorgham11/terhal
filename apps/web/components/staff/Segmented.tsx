"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type SegmentedProps<Value extends string> = {
  // Names the group for screen readers.
  label: string;
  value: Value;
  onChange: (value: Value) => void;
  options: readonly { value: Value; label: ReactNode }[];
  className?: string;
};

// A few mutually exclusive choices side by side: radio buttons underneath, so arrow keys move between them.
export function Segmented<Value extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: SegmentedProps<Value>) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex w-fit gap-1 rounded-lg bg-surface-muted p-1", className)}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            "cursor-pointer rounded-md px-3 py-1.5 text-sm transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring",
            option.value === value
              ? "bg-surface font-medium text-foreground shadow-xs"
              : "text-muted hover:text-foreground",
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
