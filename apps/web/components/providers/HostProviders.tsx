"use client";

import type { ReactNode } from "react";
import { useLocale } from "next-intl";
import { Direction } from "radix-ui";
import { Toaster } from "@/components/ui/Toast";
import { directionOf } from "@/i18n/locales";
import type { Audience } from "@/lib/api";
import { useSignedOutWatcher } from "@/lib/session/sessions";
import { QueryProvider } from "./QueryProvider";

function SignedOutWatcher({ audience }: { audience: Audience }) {
  useSignedOutWatcher(audience);
  return null;
}

// Everything a host's pages need: the query cache, the direction for Radix (menus, tabs and toasts follow it), the
// toasts, and a watch on the host's sessions so a refused refresh signs the page out at once. next-intl's provider is
// in the root layout, shared by every host.
function HostProviders({ audiences, children }: { audiences: Audience[]; children: ReactNode }) {
  const locale = useLocale();

  return (
    <QueryProvider>
      <Direction.Provider dir={directionOf(locale)}>
        {audiences.map((audience) => (
          <SignedOutWatcher key={audience} audience={audience} />
        ))}
        {children}
        <Toaster />
      </Direction.Provider>
    </QueryProvider>
  );
}

export const AdminProviders = ({ children }: { children: ReactNode }) => (
  <HostProviders audiences={["admin"]}>{children}</HostProviders>
);

export const StaffProviders = ({ children }: { children: ReactNode }) => (
  <HostProviders audiences={["staff"]}>{children}</HostProviders>
);

// Customers refresh; guests have a single cookie with nothing to refresh, so there's nothing to watch for them.
export const SiteProviders = ({ children }: { children: ReactNode }) => (
  <HostProviders audiences={["customer"]}>{children}</HostProviders>
);
