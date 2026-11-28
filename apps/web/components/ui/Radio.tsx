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
      {/* A real radio underneath, drawn over like Checkbox: choosing one colours the ring and grows the dot in. */}
      <span className="relative mt-0.5 inline-flex size-4.5 shrink-0">
        <input
          type="radio"
          id={inputId}
          aria-describedby={descriptionId}
          className="peer absolute inset-0 m-0 cursor-pointer appearance-none rounded-full border border-input bg-surface transition-[border-color,box-shadow] duration-200 checked:border-primary hover:border-muted checked:hover:border-primary-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          {...props}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 m-auto size-2.5 scale-0 rounded-full bg-primary transition-transform duration-200 ease-out peer-checked:scale-100 peer-hover:peer-checked:bg-primary-hover"
        />
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
