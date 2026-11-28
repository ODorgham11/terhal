"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useNow, useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller } from "react-hook-form";
import { IconDeviceDesktop, IconLogout, IconMail } from "@tabler/icons-react";
import { z } from "zod";
import { ChangePassword, UpdateStaffAccount, type Staff } from "@terhal/contracts";
import { DirectionalIcon } from "@/components/DirectionalIcon";
import { RequireStaff } from "@/components/session/RequireSession";
import { Avatar } from "@/components/staff/Avatar";
import { SectionCard } from "@/components/staff/SectionCard";
import { Segmented } from "@/components/staff/Segmented";
import { describeDevice } from "@/components/staff/account/device";
import { PermissionChips } from "@/components/staff/team/PermissionSwitches";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Form, FormError, FormField } from "@/components/ui/Form";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { locales, type Locale } from "@/i18n/locales";
import { setLocaleCookie } from "@/i18n/set-locale";
import { call, staffApi, useErrorMessage } from "@/lib/api";
import { useZodForm } from "@/lib/forms/useZodForm";
import { sessionKey } from "@/lib/session/sessions";

export function AccountPage() {
  return <RequireStaff>{(staff) => <Account staff={staff} />}</RequireStaff>;
}

function Account({ staff }: { staff: Staff }) {
  const t = useTranslations("staff.account");
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
        <p className="text-base text-muted">
          {staff.firstName} {staff.lastName}
        </p>
      </header>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <ProfileCard staff={staff} />
          <PasswordCard />
        </div>
        <div className="flex flex-col gap-5">
          <DevicesCard />
          <SectionCard title={t("access.title")}>
            <PermissionChips permissions={staff.permissions} />
            <p className="text-xs text-muted">{t("access.hint")}</p>
          </SectionCard>
          <LanguageCard staff={staff} />
        </div>
      </div>
    </>
  );
}

const ProfileForm = z.object({
  firstName: UpdateStaffAccount.shape.firstName.unwrap(),
  lastName: UpdateStaffAccount.shape.lastName.unwrap(),
  phone: z.string().optional(),
});

function ProfileCard({ staff }: { staff: Staff }) {
  const t = useTranslations("staff.account.profile");
  const fields = useTranslations("common.fields");
  const client = useQueryClient();
  const form = useZodForm(ProfileForm, {
    defaultValues: {
      firstName: staff.firstName,
      lastName: staff.lastName,
      phone: staff.phone ?? "",
    },
  });

  return (
    <SectionCard title={t("title")}>
      <div className="flex items-center gap-3">
        <Avatar
          firstName={staff.firstName}
          lastName={staff.lastName}
          className="size-12 text-base"
        />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-foreground">
            {staff.firstName} {staff.lastName}
          </span>
          <span className="truncate text-xs text-muted" dir="ltr">
            {staff.email}
          </span>
        </div>
      </div>
      <Form
        form={form}
        onSubmit={async ({ phone, ...values }) => {
          const saved = await call(
            staffApi.account.$patch({ json: { ...values, phone: phone?.trim() || null } }),
          );
          client.setQueryData(sessionKey("staff"), { status: "signed-in", user: saved });
          form.reset({
            firstName: saved.firstName,
            lastName: saved.lastName,
            phone: saved.phone ?? "",
          });
          toast.success(t("saved"));
        }}
      >
        <FormError />
        <div className="grid gap-4 sm:grid-cols-2">
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
            render={({ field }) => <PhoneInput {...field} />}
          />
        </FormField>
        <Field label={fields("email")} hint={t("emailHint")}>
          <Input
            value={staff.email}
            readOnly
            disabled
            dir="ltr"
            startAdornment={<IconMail aria-hidden className="size-4.5" stroke={1.75} />}
          />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" loading={form.formState.isSubmitting}>
            {t("save")}
          </Button>
        </div>
      </Form>
    </SectionCard>
  );
}

const PasswordForm = ChangePassword.extend({ confirmPassword: z.string() }).refine(
  (values) => values.newPassword === values.confirmPassword,
  { path: ["confirmPassword"] },
);

function PasswordCard() {
  const t = useTranslations("staff.account.password");
  const fields = useTranslations("common.fields");
  const client = useQueryClient();
  const form = useZodForm(PasswordForm, {
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  return (
    <SectionCard title={t("title")}>
      <Form
        form={form}
        onSubmit={async ({ currentPassword, newPassword }) => {
          await call(staffApi.auth.password.$post({ json: { currentPassword, newPassword } }));
          form.reset();
          // The other sessions were ended.
          await client.invalidateQueries({ queryKey: ["staff", "account", "sessions"] });
          toast.success(t("changed"));
        }}
      >
        <FormError />
        <FormField name="currentPassword" label={fields("currentPassword")}>
          <PasswordInput autoComplete="current-password" {...form.register("currentPassword")} />
        </FormField>
        <FormField name="newPassword" label={fields("newPassword")} hint={t("hint")}>
          <PasswordInput autoComplete="new-password" {...form.register("newPassword")} />
        </FormField>
        <FormField name="confirmPassword" label={fields("confirmPassword")}>
          <PasswordInput autoComplete="new-password" {...form.register("confirmPassword")} />
        </FormField>
        <div className="flex justify-end">
          <Button type="submit" loading={form.formState.isSubmitting}>
            {t("submit")}
          </Button>
        </div>
      </Form>
    </SectionCard>
  );
}

function DevicesCard() {
  const t = useTranslations("staff.account.devices");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const sessions = useQuery({
    queryKey: ["staff", "account", "sessions"],
    queryFn: () => call(staffApi.auth.sessions.$get()),
  });
  const others = sessions.data?.data.filter((session) => !session.current).length ?? 0;

  const end = async (id: string | "all") => {
    setBusy(id);
    try {
      if (id === "all") await call(staffApi.auth.sessions.all.revoke.$post());
      else await call(staffApi.auth.sessions[":id"].$delete({ param: { id } }));
      await client.invalidateQueries({ queryKey: ["staff", "account", "sessions"] });
      toast.success(id === "all" ? t("othersEnded") : t("ended"));
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SectionCard
      title={t("title")}
      aside={
        others > 0 && (
          <Button
            variant="ghost"
            size="sm"
            loading={busy === "all"}
            onClick={() => void end("all")}
          >
            <DirectionalIcon icon={IconLogout} className="size-4" stroke={1.75} />
            {t("signOutOthers")}
          </Button>
        )
      }
    >
      {sessions.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : sessions.isError ? (
        <p className="text-sm text-muted">{errorMessage(sessions.error)}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {sessions.data.data.map((session) => {
            const device = describeDevice(session.userAgent);
            const label = device
              ? device.browser && device.system
                ? t("on", { browser: device.browser, system: device.system })
                : (device.browser ?? device.system)
              : t("unknown");
            return (
              <li key={session.id} className="flex items-center gap-3 py-3">
                <IconDeviceDesktop
                  aria-hidden
                  className="size-5 shrink-0 text-muted"
                  stroke={1.75}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                    {label}
                    {session.current && <Badge tone="success">{t("thisDevice")}</Badge>}
                  </span>
                  <span className="text-xs text-muted">
                    {[
                      session.ipAddress && <span dir="ltr">{session.ipAddress}</span>,
                      t("signedIn", {
                        when: format.relativeTime(new Date(session.createdAt), now),
                      }),
                    ]
                      .filter(Boolean)
                      .map((part, index) => (
                        <span key={index}>
                          {index > 0 && " · "}
                          {part}
                        </span>
                      ))}
                  </span>
                </div>
                {!session.current && (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy === session.id}
                    onClick={() => void end(session.id)}
                  >
                    {t("signOut")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

const languageNames: Record<Locale, string> = { en: "English", ar: "العربية" };

// The dashboard's language for this browser, and the one emails come in.
function LanguageCard({ staff }: { staff: Staff }) {
  const t = useTranslations("staff.account.language");
  const current = useLocale() as Locale;
  const router = useRouter();
  const client = useQueryClient();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();

  const change = async (locale: Locale) => {
    setLocaleCookie(locale);
    startTransition(() => router.refresh());
    if (staff.locale === locale) return;
    try {
      const saved = await call(staffApi.account.$patch({ json: { locale } }));
      client.setQueryData(sessionKey("staff"), { status: "signed-in", user: saved });
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
  };

  return (
    <SectionCard title={t("title")}>
      <Segmented
        label={t("title")}
        value={current}
        onChange={(locale) => void change(locale)}
        options={locales.map((locale) => ({ value: locale, label: languageNames[locale] }))}
        className={pending ? "opacity-60" : undefined}
      />
      <p className="text-xs text-muted">{t("hint")}</p>
    </SectionCard>
  );
}
