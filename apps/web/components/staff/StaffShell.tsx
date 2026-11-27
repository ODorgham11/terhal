"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import type { Staff } from "@terhal/contracts";
import { RequireStaff } from "@/components/session/RequireSession";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

// The dashboard's frame: the sidebar on the inline start (full on desktops, an icon rail on tablets, a slide-in menu on
// phones), the top bar, then the page.
export function StaffShell({ staff, children }: { staff: Staff; children: ReactNode }) {
  const t = useTranslations("staff.nav");
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-dvh">
      <div className="sticky top-0 hidden h-dvh shrink-0 md:block xl:hidden">
        <Sidebar staff={staff} variant="rail" />
      </div>
      <div className="sticky top-0 hidden h-dvh shrink-0 xl:block">
        <Sidebar staff={staff} variant="full" />
      </div>

      <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="animate-overlay fixed inset-0 z-50 bg-overlay md:hidden" />
          <Dialog.Content
            aria-describedby={undefined}
            className="animate-drawer-start fixed inset-y-0 start-0 z-50 shadow-xl focus:outline-none md:hidden"
          >
            <Dialog.Title className="sr-only">{t("label")}</Dialog.Title>
            <Sidebar
              staff={staff}
              variant="full"
              onNavigate={() => setMenuOpen(false)}
              className="w-75"
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar staff={staff} onOpenMenu={() => setMenuOpen(true)} />
        <main className="flex flex-1 flex-col gap-6 p-4 md:p-6 xl:p-8">{children}</main>
      </div>
    </div>
  );
}

// Every signed-in page: the guard, then the frame. Pages that need a permission add their own <RequireStaff permission>.
export function StaffFrame({ children }: { children: ReactNode }) {
  return (
    <RequireStaff>{(staff) => <StaffShell staff={staff}>{children}</StaffShell>}</RequireStaff>
  );
}
