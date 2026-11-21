"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type SwitchProps = Omit<ComponentProps<"input">, "type" | "role"> & {
  label: ReactNode;
  description?: ReactNode;
};

// An on/off setting. A native checkbox with role="switch", so screen readers announce on/off and register("field")
// works as is. The thumb travels toward the inline end, which is leftwards in Arabic.
export function Switch({ label, description, id, className, ...props }: SwitchProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const descriptionId = description ? `${inputId}-description` : undefined;

  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="flex flex-col gap-0.5">
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {description && (
          <p id={descriptionId} className="text-sm text-muted">
            {description}
          </p>
        )}
      </div>
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          id={inputId}
          aria-describedby={descriptionId}
          className="peer h-6 w-11 cursor-pointer appearance-none rounded-full bg-input transition-colors checked:bg-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          {...props}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute start-0.5 top-0.5 size-5 rounded-full bg-surface shadow transition-transform ltr:peer-checked:translate-x-5 rtl:peer-checked:-translate-x-5"
        />
      </span>
    </div>
  );
}
