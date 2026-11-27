"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { IconMail } from "@tabler/icons-react";
import { RequestStaffPasswordReset } from "@terhal/contracts";
import { AuthCard, AuthIcon } from "@/components/staff/AuthCard";
import { Button } from "@/components/ui/Button";
import { Form, FormError, FormField } from "@/components/ui/Form";
import { Input } from "@/components/ui/Input";
import { call, staffApi } from "@/lib/api";
import { useZodForm } from "@/lib/forms/useZodForm";
import { staffRoutes } from "@/lib/session/routes";

// Asks for a reset link. The API answers the same whether or not the email has an account, and so does this page.
export function ForgotPasswordForm() {
  const t = useTranslations("staff.auth.forgotPassword");
  const fields = useTranslations("common.fields");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useZodForm(RequestStaffPasswordReset, { defaultValues: { email: "" } });

  if (sentTo) {
    return (
      <AuthCard
        icon={
          <AuthIcon tone="primary">
            <IconMail className="size-5.5" stroke={1.75} />
          </AuthIcon>
        }
        title={t("sentTitle")}
        description={t.rich("sentDescription", {
          email: () => (
            <span dir="ltr" className="font-medium text-foreground">
              {sentTo}
            </span>
          ),
        })}
      >
        <Button asChild size="lg" className="w-full">
          <Link href={staffRoutes.signIn}>{t("backToSignIn")}</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("title")} description={t("description")}>
      <Form
        form={form}
        onSubmit={async (json) => {
          await call(staffApi.auth.password.reset.request.$post({ json }));
          setSentTo(json.email);
        }}
        className="flex flex-col gap-5"
      >
        <FormError />
        <FormField name="email" label={fields("email")}>
          <Input
            type="email"
            autoComplete="username"
            startAdornment={<IconMail aria-hidden className="size-4.5" stroke={1.75} />}
            {...form.register("email")}
          />
        </FormField>
        <div className="flex flex-col gap-3">
          <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
            {t("submit")}
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link href={staffRoutes.signIn}>{t("backToSignIn")}</Link>
          </Button>
        </div>
      </Form>
    </AuthCard>
  );
}
