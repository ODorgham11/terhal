"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { IconMail, IconShieldLock } from "@tabler/icons-react";
import { AdminSignIn } from "@terhal/contracts";
import { CodeStep } from "@/components/admin/CodeStep";
import { AuthCard, AuthIcon } from "@/components/staff/AuthCard";
import { Button } from "@/components/ui/Button";
import { Form, FormError, FormField } from "@/components/ui/Form";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { adminApi, call } from "@/lib/api";
import { useZodForm } from "@/lib/forms/useZodForm";
import { safeNext } from "@/lib/session/routes";
import { sessionKey, useAdminSession } from "@/lib/session/sessions";

const nextPath = () => safeNext(new URLSearchParams(window.location.search).get("next"));

// Two steps: the password, then a code from the authenticator app (the API holds a 5-minute challenge in between).
export function AdminSignInForm() {
  const t = useTranslations("admin.auth.signIn");
  const fields = useTranslations("common.fields");
  const router = useRouter();
  const client = useQueryClient();
  const session = useAdminSession();
  const [step, setStep] = useState<"password" | "code">("password");
  const form = useZodForm(AdminSignIn, { defaultValues: { email: "", password: "" } });

  useEffect(() => {
    if (session.status === "signed-in") router.replace(nextPath());
  }, [session.status, router]);

  if (step === "code") {
    return (
      <AuthCard
        title={t("codeTitle")}
        description={t("codeDescription")}
        icon={
          <AuthIcon tone="primary">
            <IconShieldLock className="size-5.5" stroke={1.75} />
          </AuthIcon>
        }
      >
        <CodeStep
          submitLabel={t("verify")}
          onSubmit={async (code) => {
            const admin = await call(adminApi.auth.verify.$post({ json: { code } }));
            client.setQueryData(sessionKey("admin"), { status: "signed-in", user: admin });
            router.replace(nextPath());
          }}
        />
        <Button variant="link" onClick={() => setStep("password")}>
          {t("back")}
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("title")} description={t("description")}>
      <Form
        form={form}
        onSubmit={async (json) => {
          await call(adminApi.auth["sign-in"].$post({ json }));
          setStep("code");
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
        <FormField name="password" label={fields("password")}>
          <PasswordInput autoComplete="current-password" {...form.register("password")} />
        </FormField>
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          {t("submit")}
        </Button>
      </Form>
    </AuthCard>
  );
}
