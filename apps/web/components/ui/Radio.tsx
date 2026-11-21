"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type RadioGroupProps = {
  legend: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
};

// A fieldset of native radios: arrow keys move between them in the right direction for the page, and each Radio
// works with register("field") as is.
//
//   <RadioGroup legend={t("payment")}>
//     <Radio value="cash" label={t("cash")} {...register("payment")} />
//     <Radio value="card" label={t("card")} {...register("payment")} />
//   </RadioGroup>
export function RadioGroup({ legend, error, className, children }: RadioGroupProps) {
  const errorId = useId();

  return (
    <fieldset
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
      className={cn("flex flex-col gap-2", className)}
    >
      <legend className="mb-1 text-sm font-medium text-foreground">{legend}</legend>
      {children}
      {error && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

type RadioProps = Omit<ComponentProps<"input">, "type"> & {
  label: ReactNode;
  description?: ReactNode;
};

export function Radio({ label, description, id, className, ...props }: RadioProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const descriptionId = description ? `${inputId}-description` : undefined;

  return (
    <div className={cn("flex items-start gap-3", className)}>
      <input
        type="radio"
        id={inputId}
        aria-describedby={descriptionId}
        className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
        {...props}
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={inputId} className="text-sm text-foreground">
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
