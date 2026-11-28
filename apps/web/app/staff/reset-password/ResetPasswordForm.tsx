"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CompleteStaffPasswordReset } from "@terhal/contracts";
import { AuthCard } from "@/components/staff/AuthCard";
import { LinkExpired } from "@/components/staff/LinkExpired";
import { Button } from "@/components/ui/Button";
import { Form, FormError, FormField } from "@/components/ui/Form";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { toast } from "@/components/ui/Toast";
import { call, isApiError, staffApi, useErrorMessage } from "@/lib/api";
import { withConfirmation } from "@/lib/forms/confirm-password";
import { useZodForm } from "@/lib/forms/useZodForm";
import { useLinkToken } from "@/lib/session/link-token";
import { staffRoutes } from "@/lib/session/routes";

const ResetForm = withConfirmation(CompleteStaffPasswordReset.omit({ token: true }));

export function ResetPasswordForm() {
  const t = useTranslations("staff.auth.resetPassword");
  const fields = useTranslations("common.fields");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const token = useLinkToken();
  // The link is only checked when the form is sent; a dead one swaps the form for the "link expired" card.
  const [deadLink, setDeadLink] = useState<string | null>(null);
  const form = useZodForm(ResetForm, { defaultValues: { password: "", confirmPassword: "" } });

  if (token === undefined) return null;
  if (token === null) return <LinkExpired />;
  if (deadLink) return <LinkExpired message={deadLink} />;

  return (
    <AuthCard title={t("title")} description={t("description")}>
      <Form
        form={form}
        onSubmit={async ({ password }) => {
          try {
            await call(staffApi.auth.password.reset.complete.$post({ json: { token, password } }));
          } catch (error) {
            if (
              isApiError(error) &&
              (error.code === "PASSWORD_RESET_INVALID" || error.code === "PASSWORD_RESET_EXPIRED")
            ) {
              setDeadLink(errorMessage(error));
              return;
            }
            throw error;
          }
          toast.success(t("done"));
          router.replace(staffRoutes.signIn);
        }}
        className="gap-5"
      >
        <FormError />
        <FormField name="password" label={fields("newPassword")} hint={t("passwordHint")}>
          <PasswordInput autoComplete="new-password" {...form.register("password")} />
        </FormField>
        <FormField name="confirmPassword" label={fields("confirmPassword")}>
          <PasswordInput autoComplete="new-password" {...form.register("confirmPassword")} />
        </FormField>
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          {t("submit")}
        </Button>
      </Form>
    </AuthCard>
  );
}
