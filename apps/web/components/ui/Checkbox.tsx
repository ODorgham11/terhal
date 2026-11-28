"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type CheckboxProps = Omit<ComponentProps<"input">, "type"> & {
  label: ReactNode;
  description?: ReactNode;
};

// A real checkbox underneath, so register("field") works as is; the box is drawn over it. Checking fills it and draws
// the tick in; all CSS, from the input's own :checked, so it animates with register() as well as when controlled. Use
// it for a yes/no that takes effect on submit; for a setting that applies at once, use Switch.
export function Checkbox({ label, description, id, className, ...props }: CheckboxProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const descriptionId = description ? `${inputId}-description` : undefined;

  return (
    <div className={cn("flex items-start gap-3", className)}>
      <span className="relative mt-0.5 inline-flex size-4.5 shrink-0">
        <input
          type="checkbox"
          id={inputId}
          aria-describedby={descriptionId}
          className="peer absolute inset-0 m-0 cursor-pointer appearance-none rounded-[0.3125rem] border border-input bg-surface transition-[background-color,border-color,box-shadow] duration-200 checked:border-primary checked:bg-primary hover:border-muted checked:hover:border-primary-hover checked:hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          {...props}
        />
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          fill="none"
          className="pointer-events-none absolute inset-0 m-auto size-3.5 scale-75 text-primary-foreground opacity-0 transition-[opacity,scale] duration-200 peer-checked:scale-100 peer-checked:opacity-100 [&>path]:[stroke-dasharray:14] [&>path]:[stroke-dashoffset:14] [&>path]:transition-[stroke-dashoffset] [&>path]:duration-250 [&>path]:ease-out peer-checked:[&>path]:[stroke-dashoffset:0]"
        >
          <path
            d="M3.5 8.5 6.5 11.5 12.5 4.5"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <div className="flex flex-col gap-0.5">
        <label
          htmlFor={inputId}
          className="cursor-pointer text-sm font-medium text-foreground select-none"
        >
          {label}
        </label>
        {description && (
          <p id={descriptionId} className="text-sm text-muted">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
