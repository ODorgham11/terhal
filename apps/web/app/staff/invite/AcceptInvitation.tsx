"use client";

import { useRouter } from "next/navigation";
import { Controller } from "react-hook-form";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconMail } from "@tabler/icons-react";
import { AcceptStaffInvitation, StaffInvitationPreview } from "@terhal/contracts";
import type { z } from "zod";
import { AuthCard } from "@/components/staff/AuthCard";
import { LinkExpired } from "@/components/staff/LinkExpired";
import { Button } from "@/components/ui/Button";
import { Form, FormError, FormField } from "@/components/ui/Form";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { Spinner } from "@/components/ui/Spinner";
import { call, isApiError, staffApi, useErrorMessage } from "@/lib/api";
import { withConfirmation } from "@/lib/forms/confirm-password";
import { useZodForm } from "@/lib/forms/useZodForm";
import { useLinkToken } from "@/lib/session/link-token";
import { sessionKey } from "@/lib/session/sessions";

const InvitationSchema = withConfirmation(AcceptStaffInvitation.omit({ token: true }));

export function AcceptInvitation() {
  const token = useLinkToken();
  const errorMessage = useErrorMessage();
  const preview = useQuery({
    queryKey: ["staff", "invitation", token],
    queryFn: () => call(staffApi.invitations.lookup.$get({ query: { token: token ?? "" } })),
    enabled: Boolean(token),
    retry: false,
  });

  if (token === undefined) return null;
  if (token === null) return <LinkExpired />;
  if (preview.isError) {
    // A used, revoked or expired invitation; anything else (offline) says so in its own words.
    return (
      <LinkExpired message={isApiError(preview.error) ? errorMessage(preview.error) : undefined} />
    );
  }
  if (!preview.data) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-muted">
        <Spinner className="size-6" />
      </main>
    );
  }

  return <InvitationForm token={token} invitation={preview.data} />;
}

function InvitationForm({
  token,
  invitation,
}: {
  token: string;
  invitation: z.infer<typeof StaffInvitationPreview>;
}) {
  const t = useTranslations("staff.auth.invite");
  const fields = useTranslations("common.fields");
  const router = useRouter();
  const client = useQueryClient();
  const form = useZodForm(InvitationSchema, {
    defaultValues: {
      firstName: "",
      lastName: "",
      phone: undefined,
      password: "",
      confirmPassword: "",
    },
  });

  return (
    <AuthCard title={t("title")} description={t("description")}>
      <div className="flex items-center gap-2.5 rounded-lg bg-surface-muted px-3.5 py-2.5 text-sm text-foreground">
        <IconMail aria-hidden className="size-4.5 shrink-0 text-muted" stroke={1.75} />
        <span dir="ltr" className="truncate">
          {invitation.email}
        </span>
      </div>
      <Form
        form={form}
        onSubmit={async ({ firstName, lastName, phone, password }) => {
          const staff = await call(
            staffApi.invitations.accept.$post({
              json: { token, firstName, lastName, phone, password },
            }),
          );
          client.setQueryData(sessionKey("staff"), { status: "signed-in", user: staff });
          router.replace("/");
        }}
        className="gap-5"
      >
        <FormError />
        <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
          <FormField name="firstName" label={fields("firstName")}>
            <Input autoComplete="given-name" {...form.register("firstName")} />
          </FormField>
          <FormField name="lastName" label={fields("lastName")}>
            <Input autoComplete="family-name" {...form.register("lastName")} />
          </FormField>
        </div>
        <FormField name="phone" label={fields("phone")} optional>
          <Controller
            control={form.control}
            name="phone"
            render={({ field }) => (
              <PhoneInput {...field} onChange={(phone) => field.onChange(phone || undefined)} />
            )}
          />
        </FormField>
        <FormField name="password" label={fields("password")} hint={t("passwordHint")}>
          <PasswordInput autoComplete="new-password" {...form.register("password")} />
        </FormField>
        <FormField name="confirmPassword" label={fields("confirmPassword")}>
          <PasswordInput autoComplete="new-password" {...form.register("confirmPassword")} />
        </FormField>
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          {t("submit")}
        </Button>
      </Form>
    </AuthCard>
  );
}
