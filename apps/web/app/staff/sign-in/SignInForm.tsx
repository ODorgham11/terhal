"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { IconMail } from "@tabler/icons-react";
import { StaffSignIn } from "@terhal/contracts";
import type { z } from "zod";
import { AuthCard } from "@/components/staff/AuthCard";
import { Button } from "@/components/ui/Button";
import { Form, FormError, FormField } from "@/components/ui/Form";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { call, staffApi } from "@/lib/api";
import { useZodForm } from "@/lib/forms/useZodForm";
import { safeNext, staffRoutes } from "@/lib/session/routes";
import { sessionKey, useStaffSession } from "@/lib/session/sessions";

// Read when needed rather than with useSearchParams, which would need a Suspense boundary.
const nextPath = () => safeNext(new URLSearchParams(window.location.search).get("next"));

export function SignInForm() {
  const t = useTranslations("staff.auth.signIn");
  const fields = useTranslations("common.fields");
  const router = useRouter();
  const client = useQueryClient();
  const session = useStaffSession();
  const form = useZodForm(StaffSignIn, { defaultValues: { email: "", password: "" } });

  // Already signed in (another tab, the back button): straight on.
  useEffect(() => {
    if (session.status === "signed-in") router.replace(nextPath());
  }, [session.status, router]);

  const signIn = async (json: z.output<typeof StaffSignIn>) => {
    const staff = await call(staffApi.auth["sign-in"].$post({ json }));
    client.setQueryData(sessionKey("staff"), { status: "signed-in", user: staff });
    router.replace(nextPath());
  };

  return (
    <AuthCard title={t("title")} description={t("description")}>
      <Form form={form} onSubmit={signIn} className="flex flex-col gap-5">
        <FormError />
        <FormField name="email" label={fields("email")}>
          <Input
            type="email"
            autoComplete="username"
            startAdornment={<IconMail aria-hidden className="size-4.5" stroke={1.75} />}
            {...form.register("email")}
          />
        </FormField>
        <FormField
          name="password"
          label={fields("password")}
          labelAction={
            <Link
              href={staffRoutes.forgotPassword}
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("forgotPassword")}
            </Link>
          }
        >
          <PasswordInput autoComplete="current-password" {...form.register("password")} />
        </FormField>
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          {t("submit")}
        </Button>
      </Form>
    </AuthCard>
  );
}
