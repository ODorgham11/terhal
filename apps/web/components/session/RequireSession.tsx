"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { IconCloudOff, IconLock } from "@tabler/icons-react";
import type { Admin, Customer, Guest, Staff, StaffPermission } from "@terhal/contracts";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { StaffForbidden } from "@/components/staff/SystemState";
import { adminRoutes, siteRoutes, staffRoutes, withNext } from "@/lib/session/routes";
import {
  useAdminSession,
  useCustomerSession,
  useGuest,
  useStaffSession,
  type SessionState,
} from "@/lib/session/sessions";

type GuardProps<User> = {
  session: SessionState<User>;
  // Where to go when signed out; the current page is passed along as ?next=.
  signIn: string;
  // Where to go when the session exists but isn't verified yet (guests).
  verify?: string;
  // Rendered with the user once signed in. A function, so pages get a non-null user without checking again.
  children: (user: User) => ReactNode;
  // Extra check once signed in; when it fails, a "no access" message shows instead.
  allow?: (user: User) => boolean;
  // Shown instead of the generic "no access" when allow() refuses.
  forbidden?: ReactNode;
  // Shown while the session loads (and on the way to sign in), in place of the spinner: a skeleton of the page.
  loading?: ReactNode;
};

// Shows its children only to a signed-in user, and sends anyone else to sign in. Client-side only: the API checks every
// request anyway, so this is about what the page shows, not about security.
function SessionGuard<User>({
  session,
  signIn,
  verify,
  children,
  allow,
  forbidden,
  loading,
}: GuardProps<User>) {
  const t = useTranslations("common.session");
  const router = useRouter();
  const target =
    session.status === "signed-out"
      ? signIn
      : session.status === "unverified"
        ? (verify ?? signIn)
        : null;

  useEffect(() => {
    if (!target) return;
    // Read here rather than with useSearchParams, which would need a Suspense boundary around every guarded page.
    const here = `${window.location.pathname}${window.location.search}`;
    router.replace(withNext(target, here));
  }, [target, router]);

  if (session.status === "signed-in") {
    if (allow && !allow(session.user)) {
      if (forbidden) return forbidden;
      return (
        <EmptyState
          icon={IconLock}
          title={t("forbiddenTitle")}
          description={t("forbiddenDescription")}
        />
      );
    }
    return children(session.user);
  }

  if (session.status === "error") {
    return (
      <EmptyState
        icon={IconCloudOff}
        title={t("unreachableTitle")}
        description={t("unreachableDescription")}
        action={
          <Button variant="secondary" onClick={session.retry}>
            {t("retry")}
          </Button>
        }
      />
    );
  }

  // Loading, or on the way to sign in.
  if (loading) return loading;
  return (
    <div className="flex flex-1 items-center justify-center p-12 text-muted">
      <Spinner className="size-6" />
    </div>
  );
}

type RequireProps<User> = Pick<GuardProps<User>, "children">;

//   <RequireAdmin>{(admin) => <p>{admin.firstName}</p>}</RequireAdmin>
export function RequireAdmin({
  loading,
  children,
}: RequireProps<Admin> & Pick<GuardProps<Admin>, "loading">) {
  return (
    <SessionGuard session={useAdminSession()} signIn={adminRoutes.signIn} loading={loading}>
      {children}
    </SessionGuard>
  );
}

// With `permission`, staff without it see "no access" instead of the page (the API refuses them anyway).
export function RequireStaff({
  permission,
  loading,
  children,
}: RequireProps<Staff> & Pick<GuardProps<Staff>, "loading"> & { permission?: StaffPermission }) {
  return (
    <SessionGuard
      session={useStaffSession()}
      signIn={staffRoutes.signIn}
      allow={permission ? (staff) => staff.permissions.includes(permission) : undefined}
      forbidden={permission && <StaffForbidden permission={permission} />}
      loading={loading}
    >
      {children}
    </SessionGuard>
  );
}

export function RequireCustomer({ children }: RequireProps<Customer>) {
  return (
    <SessionGuard session={useCustomerSession()} signIn={siteRoutes.signIn}>
      {children}
    </SessionGuard>
  );
}

// A guest booking without an account: no session sends them to enter their details, an unconfirmed one to the code.
export function RequireGuest({ children }: RequireProps<Guest>) {
  return (
    <SessionGuard session={useGuest()} signIn={siteRoutes.guest} verify={siteRoutes.guestVerify}>
      {children}
    </SessionGuard>
  );
}
