"use client";

import { useCallback, useMemo } from "react";
import { toNestErrors, validateFieldsNatively } from "@hookform/resolvers";
import {
  useForm,
  type FieldError,
  type FieldErrors,
  type FieldValues,
  type Path,
  type Resolver,
  type UseFormProps,
  type UseFormReturn,
} from "react-hook-form";
import type { z } from "zod";
import { isApiError, useErrorMessage } from "@/lib/api";
import { useIssueMessage } from "./issues";

type Schema = z.ZodType<FieldValues, FieldValues>;

// react-hook-form validating against a @terhal/contracts schema, with every message in the page's language
// (lib/forms/issues). The values handed to onSubmit are the schema's output: trimmed, lowercased, phone numbers in
// +20 form, exactly what the API expects.
//
//   const form = useZodForm(CustomerSignIn, { defaultValues: { identifier: "", password: "" } });
//
// Pass it to <Form form={form} onSubmit={...}> (components/ui/Form), which also shows the API's errors.
export function useZodForm<S extends Schema>(
  schema: S,
  options?: Omit<UseFormProps<z.input<S>, unknown, z.output<S>>, "resolver">,
): UseFormReturn<z.input<S>, unknown, z.output<S>> {
  const message = useIssueMessage();

  const resolver = useMemo<Resolver<z.input<S>, unknown, z.output<S>>>(
    () => async (values, _context, resolverOptions) => {
      const result = await schema.safeParseAsync(values);
      if (result.success) return { values: result.data as z.output<S>, errors: {} };

      // The first problem per field, which is the one the field shows.
      const errors: Record<string, FieldError> = {};
      for (const issue of result.error.issues) {
        const path = issue.path.map(String).join(".") || "root";
        errors[path] ??= { type: issue.code, message: message(issue) };
      }

      if (resolverOptions.shouldUseNativeValidation)
        validateFieldsNatively(errors, resolverOptions);
      return { values: {}, errors: toNestErrors(errors as FieldErrors, resolverOptions) };
    },
    [schema, message],
  );

  return useForm<z.input<S>, unknown, z.output<S>>({ mode: "onTouched", ...options, resolver });
}

// Puts a failed request's errors on the form: each field the API rejected gets its message under the field, and
// anything else becomes the form's own error (errors.root.server), which <FormError> shows.
export function useApplyApiError<Values extends FieldValues>(form: UseFormReturn<Values>) {
  const errorMessage = useErrorMessage();
  const issueMessage = useIssueMessage();

  return useCallback(
    (error: unknown) => {
      const fields = isApiError(error) && error.code === "VALIDATION_FAILED" ? error.errors : [];
      for (const issue of fields) {
        form.setError(issue.path as Path<Values>, {
          type: "server",
          message: issueMessage(issue),
        });
      }
      if (fields.length === 0) {
        form.setError("root.server", { type: "server", message: errorMessage(error) });
      }
    },
    [form, errorMessage, issueMessage],
  );
}
