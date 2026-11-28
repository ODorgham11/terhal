"use client";

import { useId, type ReactNode } from "react";
import { motion } from "motion/react";
import { ease } from "@/components/ui/Motion";
import { cn } from "@/lib/cn";

type SegmentedProps<Value extends string> = {
  // Names the group for screen readers.
  label: string;
  value: Value;
  onChange: (value: Value) => void;
  options: readonly { value: Value; label: ReactNode }[];
  className?: string;
};

// A few mutually exclusive choices side by side: radio buttons underneath, so arrow keys move between them. The white
// pill slides to the chosen one.
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
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "relative cursor-pointer rounded-md px-3 py-1.5 text-sm transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring",
              checked ? "font-medium text-foreground" : "text-muted hover:text-foreground",
            )}
          >
            {checked && (
              <motion.span
                aria-hidden
                layoutId={`${name}-pill`}
                transition={ease}
                className="absolute inset-0 rounded-md bg-surface shadow-xs"
              />
            )}
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            <span className="relative">{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}
