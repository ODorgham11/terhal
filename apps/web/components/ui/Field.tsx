"use client";

import { createContext, useContext, useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

type FieldContextValue = {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

type FieldProps = {
  label: ReactNode;
  // Help shown under the control, until there's an error.
  hint?: ReactNode;
  // Already translated: forms get localized messages from lib/forms.
  error?: string;
  required?: boolean;
  // Marks the label "(optional)". Most fields are required, so it's the optional ones that say so.
  optional?: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
};

// A label, the control, and its hint or error. Any control from this kit inside it (Input, Textarea, Select,
// PhoneInput, CodeInput) picks up the id, aria-describedby and aria-invalid on its own.
//
//   <Field label={t("email")} error={errors.email?.message}><Input type="email" {...register("email")} /></Field>
export function Field({
  label,
  hint,
  error,
  required = false,
  optional = false,
  id,
  className,
  children,
}: FieldProps) {
  const t = useTranslations("common.ui");
  const generated = useId();
  const controlId = id ?? generated;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <FieldContext.Provider
      value={{ id: controlId, describedBy, invalid: Boolean(error), required }}
    >
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label htmlFor={controlId} className="text-sm font-medium text-foreground">
          {label}
          {optional && <span className="ms-1 font-normal text-muted">({t("optional")})</span>}
        </label>
        {children}
        {error ? (
          <p id={errorId} className="text-sm text-danger">
            {error}
          </p>
        ) : (
          hint && (
            <p id={hintId} className="text-sm text-muted">
              {hint}
            </p>
          )
        )}
      </div>
    </FieldContext.Provider>
  );
}

// The props a control spreads onto its element, from the Field around it (if any). Its own props win.
export const useFieldControl = (props: {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
  required?: boolean;
}) => {
  const field = useContext(FieldContext);
  return {
    id: props.id ?? field?.id,
    "aria-describedby": props["aria-describedby"] ?? field?.describedBy,
    "aria-invalid": props["aria-invalid"] ?? (field?.invalid || undefined),
    required: props.required ?? (field?.required || undefined),
  };
};

// Shared by every text-like control, so they line up in a form.
export const controlClasses =
  "w-full rounded-lg border border-input bg-surface px-3 text-sm text-foreground transition-colors placeholder:text-muted " +
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:outline-none " +
  "disabled:cursor-not-allowed disabled:opacity-60 " +
  "aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/25";
