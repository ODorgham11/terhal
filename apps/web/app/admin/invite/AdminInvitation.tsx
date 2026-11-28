"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconAlertTriangle, IconMail, IconShieldLock } from "@tabler/icons-react";
import { AcceptAdminInvitation } from "@terhal/contracts";
import { CodeStep } from "@/components/admin/CodeStep";
import { AuthCard, AuthIcon } from "@/components/staff/AuthCard";
import { Button } from "@/components/ui/Button";
import { Form, FormField } from "@/components/ui/Form";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { QrCode } from "@/components/ui/QrCode";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { adminApi, call, isApiError, useErrorMessage } from "@/lib/api";
import { withConfirmation } from "@/lib/forms/confirm-password";
import { useZodForm } from "@/lib/forms/useZodForm";
import { useLinkToken } from "@/lib/session/link-token";
import { adminRoutes } from "@/lib/session/routes";
import { sessionKey } from "@/lib/session/sessions";

const DetailsSchema = withConfirmation(
  AcceptAdminInvitation.pick({ firstName: true, lastName: true, password: true }),
);
type Details = { firstName: string; lastName: string; password: string };

// An emailed admin invitation: name and password, then the authenticator app every sign-in will ask for.
export function AdminInvitation() {
  const token = useLinkToken();
  const errorMessage = useErrorMessage();
  const preview = useQuery({
    queryKey: ["admin", "invitation", token],
    queryFn: () => call(adminApi.invitations.lookup.$get({ query: { token: token ?? "" } })),
    enabled: Boolean(token),
    retry: false,
  });

  if (token === undefined) return null;
  if (token === null) return <Expired />;
  if (preview.isError)
    return (
      <Expired message={isApiError(preview.error) ? errorMessage(preview.error) : undefined} />
    );
  if (!preview.data) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-muted">
        <Spinner className="size-6" />
      </main>
    );
  }
  return <Steps token={token} email={preview.data.email} />;
}

function Expired({ message }: { message?: string }) {
  const t = useTranslations("admin.auth.invite");
  return (
    <AuthCard
      layout="centered"
      title={t("expiredTitle")}
      description={message ?? t("expiredDescription")}
      icon={
        <AuthIcon tone="warning">
          <IconAlertTriangle className="size-5.5" stroke={1.75} />
        </AuthIcon>
      }
    >
      <Button asChild variant="secondary" className="w-full">
        <Link href={adminRoutes.signIn}>{t("toSignIn")}</Link>
      </Button>
    </AuthCard>
  );
}

function Steps({ token, email }: { token: string; email: string }) {
  const t = useTranslations("admin.auth.invite");
  const fields = useTranslations("common.fields");
  const router = useRouter();
  const client = useQueryClient();
  const [details, setDetails] = useState<Details | null>(null);
  const form = useZodForm(DetailsSchema, {
    defaultValues: { firstName: "", lastName: "", password: "", confirmPassword: "" },
  });

  if (details) {
    return (
      <AuthCard
        layout="centered"
        title={t("authenticatorTitle")}
        description={t("authenticatorDescription")}
        icon={
          <AuthIcon tone="primary">
            <IconShieldLock className="size-5.5" stroke={1.75} />
          </AuthIcon>
        }
      >
        <Authenticator token={token} />
        <CodeStep
          submitLabel={t("finish")}
          onSubmit={async (code) => {
            const admin = await call(
              adminApi.invitations.accept.$post({ json: { token, ...details, code } }),
            );
            client.setQueryData(sessionKey("admin"), { status: "signed-in", user: admin });
            router.replace(adminRoutes.home);
          }}
        />
        <Button variant="link" onClick={() => setDetails(null)}>
          {t("back")}
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard layout="centered" title={t("title")} description={t("description")}>
      <div className="flex items-center gap-2.5 rounded-lg bg-surface-muted px-3.5 py-2.5 text-sm text-foreground">
        <IconMail aria-hidden className="size-4.5 shrink-0 text-muted" stroke={1.75} />
        <span dir="ltr" className="truncate">
          {email}
        </span>
      </div>
      <Form
        form={form}
        onSubmit={({ firstName, lastName, password }) =>
          setDetails({ firstName, lastName, password })
        }
        className="flex flex-col gap-5"
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField name="firstName" label={fields("firstName")}>
            <Input autoComplete="given-name" {...form.register("firstName")} />
          </FormField>
          <FormField name="lastName" label={fields("lastName")}>
            <Input autoComplete="family-name" {...form.register("lastName")} />
          </FormField>
        </div>
        <FormField name="password" label={fields("password")} hint={t("passwordHint")}>
          <PasswordInput lock={false} autoComplete="new-password" {...form.register("password")} />
        </FormField>
        <FormField name="confirmPassword" label={fields("confirmPassword")}>
          <PasswordInput
            lock={false}
            autoComplete="new-password"
            {...form.register("confirmPassword")}
          />
        </FormField>
        <Button type="submit" className="w-full">
          {t("next")}
        </Button>
      </Form>
    </AuthCard>
  );
}

// The QR code to scan, and the secret for typing in by hand. Asked for once per invitation visit.
function Authenticator({ token }: { token: string }) {
  const t = useTranslations("admin.auth.invite");
  const errorMessage = useErrorMessage();
  const setup = useQuery({
    queryKey: ["admin", "invitation", token, "totp"],
    queryFn: () => call(adminApi.invitations.totp.$post({ json: { token } })),
    staleTime: Infinity,
    retry: false,
  });
  if (setup.isPending) return <Skeleton className="mx-auto size-48" />;
  if (setup.isError) return <p className="text-sm text-danger">{errorMessage(setup.error)}</p>;
  return (
    <div className="flex flex-col items-center gap-3">
      <QrCode value={setup.data.uri} label={t("qrLabel")} />
      <p className="text-center text-xs text-muted">{t("manual")}</p>
      <code
        dir="ltr"
        className="rounded-md bg-surface-muted px-3 py-1.5 font-mono text-sm tracking-wider break-all"
      >
        {setup.data.secret}
      </code>
    </div>
  );
}
