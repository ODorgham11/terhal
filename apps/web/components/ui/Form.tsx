"use client";

import type { ComponentProps, ReactNode } from "react";
import {
  FormProvider,
  useFormContext,
  type FieldValues,
  type Path,
  type UseFormReturn,
} from "react-hook-form";
import { useApplyApiError } from "@/lib/forms/useZodForm";
import { cn } from "@/lib/cn";
import { Alert } from "./Alert";
import { Field } from "./Field";

type FormProps<Values extends FieldValues, Output> = Omit<ComponentProps<"form">, "onSubmit"> & {
  form: UseFormReturn<Values, unknown, Output>;
  // Gets the schema's output. Throw (or let call() throw) to show the API's errors on the form.
  onSubmit: (values: Output) => unknown;
};

// A form wired to react-hook-form: the browser's own validation bubbles are off (the schema's localized messages show
// instead), the submit is ignored while one is running, and a failed request's errors land on the fields or in
// <FormError>.
//
//   <Form form={form} onSubmit={(values) => call(siteApi.auth["sign-in"].$post({ json: values }))}>
//     <FormError />
//     <FormField name="identifier" label={t("fields.identifier")}><Input {...form.register("identifier")} /></FormField>
//     <Button type="submit" loading={form.formState.isSubmitting}>{t("signIn")}</Button>
//   </Form>
export function Form<Values extends FieldValues, Output>({
  form,
  onSubmit,
  className,
  children,
  ...props
}: FormProps<Values, Output>) {
  const applyApiError = useApplyApiError(form as unknown as UseFormReturn<Values>);

  return (
    <FormProvider {...form}>
      <form
        noValidate
        className={cn("flex flex-col gap-4", className)}
        onSubmit={(event) => {
          if (form.formState.isSubmitting) {
            event.preventDefault();
            return;
          }
          void form.handleSubmit(async (values) => {
            try {
              await onSubmit(values);
            } catch (error) {
              applyApiError(error);
            }
          })(event);
        }}
        {...props}
      >
        {children}
      </form>
    </FormProvider>
  );
}

type FormFieldProps = Omit<ComponentProps<typeof Field>, "error"> & {
  name: string;
};

// A Field whose error is the named form field's, so pages don't thread errors by hand. Nested names use dots
// ("address.city").
export function FormField({ name, ...props }: FormFieldProps) {
  const { getFieldState, formState } = useFormContext();
  const { error } = getFieldState(name as Path<FieldValues>, formState);
  return <Field error={error?.message} {...props} />;
}

// The form's own error: a request that failed for a reason that isn't one field's (wrong password, offline).
export function FormError({ className }: { className?: string }): ReactNode {
  const { formState } = useFormContext();
  const message = formState.errors.root?.server?.message;
  if (!message) return null;
  return <Alert tone="danger" title={message} className={className} />;
}
