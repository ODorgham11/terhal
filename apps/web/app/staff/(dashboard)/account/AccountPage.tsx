"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useNow, useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller } from "react-hook-form";
import { AnimatePresence, motion } from "motion/react";
import { IconDeviceDesktop, IconDeviceMobile, IconLock } from "@tabler/icons-react";
import { z } from "zod";
import {
  ChangePassword,
  UpdateStaffAccount,
  type AccountSession,
  type Staff,
} from "@terhal/contracts";
import { RequireStaff } from "@/components/session/RequireSession";
import { Avatar } from "@/components/staff/Avatar";
import { ConfirmDialog } from "@/components/staff/ConfirmDialog";
import { Section } from "@/components/staff/Section";
import { Segmented } from "@/components/staff/Segmented";
import { describeDevice } from "@/components/staff/account/device";
import { PermissionChips } from "@/components/staff/team/PermissionSwitches";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Form, FormError, FormField } from "@/components/ui/Form";
import { Input } from "@/components/ui/Input";
import { FadeText, Swap, fade } from "@/components/ui/Motion";
import { PageHeader } from "@/components/ui/PageHeader";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { toast } from "@/components/ui/Toast";
import { locales, type Locale } from "@/i18n/locales";
import { setLocaleCookie } from "@/i18n/set-locale";
import { call, staffApi, useErrorMessage } from "@/lib/api";
import { useZodForm } from "@/lib/forms/useZodForm";
import { useSignOut } from "@/lib/session/useSignOut";
import { sessionKey } from "@/lib/session/sessions";

// The signed-in staff member's own account, laid out like Hagz's account page: Profile, Security and Devices under
// the title, each a narrow column of sections. Profile opens with who's signed in over its sections. The email is the
// sign-in and stays as invited; access is changed by a colleague with team access.

export function AccountPage() {
  return <RequireStaff>{(staff) => <Account staff={staff} />}</RequireStaff>;
}

type Tab = "profile" | "security" | "devices";
const sessionsKey = ["staff", "account", "sessions"] as const;

function useSessions() {
  return useQuery({
    queryKey: sessionsKey,
    queryFn: () => call(staffApi.auth.sessions.$get()),
  });
}

function Account({ staff }: { staff: Staff }) {
  const t = useTranslations("staff.account");
  const [tab, setTab] = useState<Tab>("profile");
  const sessions = useSessions();
  const devices = sessions.data?.data.length;

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList>
          <TabsTrigger value="profile">{t("tabs.profile")}</TabsTrigger>
          <TabsTrigger value="security">{t("tabs.security")}</TabsTrigger>
          <TabsTrigger value="devices">
            {t("tabs.devices")}
            {devices !== undefined && (
              <span className="ms-1.5 text-xs text-muted tabular-nums">
                <FadeText value={devices} />
              </span>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {/* Half the page wide on a desktop; the whole width once that would be too narrow. */}
      <div className="lg:w-1/2">
        <Swap state={tab}>
          {tab === "profile" ? (
            <ProfileTab staff={staff} />
          ) : tab === "security" ? (
            <SecurityTab />
          ) : (
            <DevicesTab />
          )}
        </Swap>
      </div>
    </>
  );
}

// The forms keep a comfortable field width while the sections around them take half the page.
const formClass = "flex max-w-[29rem] flex-col gap-6";

const ProfileForm = z.object({
  firstName: UpdateStaffAccount.shape.firstName.unwrap(),
  lastName: UpdateStaffAccount.shape.lastName.unwrap(),
  phone: z.string().optional(),
});

function ProfileTab({ staff }: { staff: Staff }) {
  const t = useTranslations("staff.account");
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
    <>
      {/* Who's signed in: initials, name and email. */}
      <div className="flex items-center gap-5 border-b border-border pb-8">
        <Avatar firstName={staff.firstName} lastName={staff.lastName} className="size-14 text-lg" />
        <div className="min-w-0">
          <p className="truncate text-[1.375rem] leading-7 font-semibold text-foreground">
            {staff.firstName} {staff.lastName}
          </p>
          <p className="truncate text-sm text-muted" dir="ltr">
            {staff.email}
          </p>
        </div>
      </div>

      <div className="mt-8">
        <Section title={t("profile.title")} description={t("profile.description")}>
          <Form
            className={formClass}
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
              toast.success(t("profile.saved"));
            }}
          >
            <FormError />
            <div className="grid gap-x-4 gap-y-6 sm:grid-cols-2">
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
            <Field label={fields("email")} hint={t("profile.emailHint")}>
              <Input
                value={staff.email}
                readOnly
                disabled
                dir="ltr"
                endAdornment={<IconLock aria-hidden className="size-4.5" stroke={1.75} />}
              />
            </Field>
            <div>
              <Button
                type="submit"
                size="sm"
                loading={form.formState.isSubmitting}
                disabled={!form.formState.isDirty}
              >
                {t("profile.save")}
              </Button>
            </div>
          </Form>
        </Section>

        <Section title={t("access.title")} description={t("access.hint")}>
          <PermissionChips permissions={staff.permissions} />
        </Section>

        <LanguageSection staff={staff} />

        <Section title={t("session.title")} description={<SessionLine />}>
          <SignOutButton />
        </Section>
      </div>
    </>
  );
}

// When this device signed in, once the sessions are in.
function SessionLine() {
  const t = useTranslations("staff.account.session");
  const format = useFormatter();
  const here = useSessions().data?.data.find((session) => session.current);
  return (
    <>
      {here &&
        `${t("since", {
          when: format.dateTime(new Date(here.createdAt), {
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
          }),
        })} `}
      {t("othersStay")}
    </>
  );
}

// Signs this device out and goes to sign in; the spinner stays until the page changes.
function SignOutButton() {
  const t = useTranslations("staff.account.devices");
  const signOut = useSignOut("staff");
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={busy}
      onClick={() => {
        setBusy(true);
        void signOut();
      }}
    >
      {t("signOut")}
    </Button>
  );
}

const languageNames: Record<Locale, string> = { en: "English", ar: "العربية" };

// The dashboard's language for this browser, and the one emails come in.
function LanguageSection({ staff }: { staff: Staff }) {
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
    <Section title={t("title")} description={t("hint")}>
      <Segmented
        label={t("title")}
        value={current}
        onChange={(locale) => void change(locale)}
        options={locales.map((locale) => ({ value: locale, label: languageNames[locale] }))}
        className={pending ? "opacity-60" : undefined}
      />
    </Section>
  );
}

const PasswordForm = ChangePassword.extend({ confirmPassword: z.string() }).refine(
  (values) => values.newPassword === values.confirmPassword,
  { path: ["confirmPassword"] },
);

function SecurityTab() {
  const t = useTranslations("staff.account.password");
  const fields = useTranslations("common.fields");
  const client = useQueryClient();
  const [done, setDone] = useState(false);
  const form = useZodForm(PasswordForm, {
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  return (
    <Section title={t("title")} description={t("description")}>
      <Form
        className={formClass}
        form={form}
        onSubmit={async ({ currentPassword, newPassword }) => {
          setDone(false);
          await call(staffApi.auth.password.$post({ json: { currentPassword, newPassword } }));
          form.reset();
          setDone(true);
          // The other sessions were ended.
          await client.invalidateQueries({ queryKey: sessionsKey });
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
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" size="sm" loading={form.formState.isSubmitting}>
            {t("submit")}
          </Button>
          <AnimatePresence>
            {done && (
              <motion.p key="done" {...fade} role="status" className="text-sm text-muted">
                {t("changed")}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </Form>
    </Section>
  );
}

const mobile = (userAgent: string | null) => /iPhone|iPad|Android/.test(userAgent ?? "");

function DeviceRow({
  session,
  action,
}: {
  session: z.infer<typeof AccountSession>;
  action: React.ReactNode;
}) {
  const t = useTranslations("staff.account.devices");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const device = describeDevice(session.userAgent);
  const label = device
    ? device.browser && device.system
      ? t("on", { browser: device.browser, system: device.system })
      : (device.browser ?? device.system)
    : t("unknown");
  const DeviceIcon = mobile(session.userAgent) ? IconDeviceMobile : IconDeviceDesktop;
  return (
    <motion.li layout {...fade} className="flex items-center gap-3 border-b border-border py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted">
        <DeviceIcon aria-hidden className="size-4.5" stroke={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm text-foreground">
          <span className="truncate">{label}</span>
          {session.current && <Badge tone="success">{t("thisDevice")}</Badge>}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted">
          {session.ipAddress && <span dir="ltr">{session.ipAddress}</span>}
          {session.ipAddress && " · "}
          {t("signedIn", { when: format.relativeTime(new Date(session.createdAt), now) })}
        </p>
      </div>
      {action}
    </motion.li>
  );
}

function DevicesTab() {
  const t = useTranslations("staff.account.devices");
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const sessions = useSessions();
  const [ending, setEnding] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const end = async (id: string) => {
    setEnding(id);
    try {
      await call(staffApi.auth.sessions[":id"].$delete({ param: { id } }));
      await client.invalidateQueries({ queryKey: sessionsKey });
      toast.success(t("ended"));
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setEnding(null);
    }
  };

  const here = sessions.data?.data.find((session) => session.current);
  const others = sessions.data?.data.filter((session) => !session.current) ?? [];

  return (
    <Section title={t("title")} description={t("description")}>
      <Swap state={sessions.isPending ? "loading" : sessions.isError ? "error" : "ready"}>
        {sessions.isPending ? (
          <DevicesLoading />
        ) : sessions.isError ? (
          <p className="text-sm text-danger">{errorMessage(sessions.error)}</p>
        ) : (
          <>
            <ul className="border-t border-border">
              <AnimatePresence initial={false}>
                {here && <DeviceRow key={here.id} session={here} action={<SignOutButton />} />}
                {others.map((session) => (
                  <DeviceRow
                    key={session.id}
                    session={session}
                    action={
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={ending === session.id}
                        onClick={() => void end(session.id)}
                      >
                        {t("signOut")}
                      </Button>
                    }
                  />
                ))}
              </AnimatePresence>
            </ul>
            {others.length > 1 && (
              <div className="mt-5">
                <Button size="sm" variant="secondary" onClick={() => setConfirmAll(true)}>
                  {t("signOutOthers")}
                </Button>
              </div>
            )}
          </>
        )}
      </Swap>
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={t("signOutOthersTitle")}
        description={t("signOutOthersBody", { count: others.length })}
        confirmLabel={t("signOut")}
        onConfirm={async () => {
          await call(staffApi.auth.sessions.all.revoke.$post());
          await client.invalidateQueries({ queryKey: sessionsKey });
          toast.success(t("othersEnded"));
        }}
      />
    </Section>
  );
}

// The devices as they'll stand: rows with an icon, two lines and a button.
function DevicesLoading() {
  const t = useTranslations("common.ui");
  return (
    <ul role="status" className="border-t border-border">
      <span className="sr-only">{t("loading")}</span>
      {[0, 1].map((row) => (
        <li key={row} aria-hidden className="flex items-center gap-3 border-b border-border py-3">
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className={row ? "h-3.5 w-32" : "h-3.5 w-40"} />
            <Skeleton className="h-3 w-44" />
          </div>
          <Skeleton className="h-8 w-20 shrink-0 rounded-md" />
        </li>
      ))}
    </ul>
  );
}
