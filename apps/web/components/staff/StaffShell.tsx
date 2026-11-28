"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { Dialog } from "radix-ui";
import type { Staff } from "@terhal/contracts";
import { RequireStaff } from "@/components/session/RequireSession";
import { ease } from "@/components/ui/Motion";
import { Sidebar } from "./Sidebar";
import { StaffShellSkeleton } from "./StaffShellSkeleton";
import { TopBar } from "./TopBar";

// The dashboard's frame: the sidebar on the inline start (full on desktops, an icon rail on tablets, a slide-in menu on
// phones), the top bar, then the page.
export function StaffShell({ staff, children }: { staff: Staff; children: ReactNode }) {
  const t = useTranslations("staff.nav");
  const [menuOpen, setMenuOpen] = useState(false);
  // Landing on the overview, the page is simply there: it fills in without fading (see Overview.tsx).
  const [landedOnOverview] = useState(usePathname() === "/");

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
        {/* Fades in over the skeleton's spot once, when the shell first mounts (except on the overview); page changes
            don't replay it. */}
        <motion.main
          initial={landedOnOverview ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={ease}
          className="flex flex-1 flex-col gap-6 p-4 md:p-6 xl:p-8"
        >
          {children}
        </motion.main>
      </div>
    </div>
  );
}

// Every signed-in page: the guard (a gray frame while it checks the session), then the frame. Pages that need a permission add their own <RequireStaff permission>.
export function StaffFrame({ children }: { children: ReactNode }) {
  return (
    <RequireStaff loading={<StaffShellSkeleton />}>
      {(staff) => <StaffShell staff={staff}>{children}</StaffShell>}
    </RequireStaff>
  );
}
