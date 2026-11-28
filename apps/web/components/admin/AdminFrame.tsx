"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { Dialog } from "radix-ui";
import { IconLogout, IconMenu2, IconUsers } from "@tabler/icons-react";
import type { Admin } from "@terhal/contracts";
import logo from "@/assets/logo.png";
import logoMark from "@/assets/logo-mark.png";
import { DirectionalIcon } from "@/components/DirectionalIcon";
import { RequireAdmin } from "@/components/session/RequireSession";
import { Avatar } from "@/components/staff/Avatar";
import { StaffShellSkeleton } from "@/components/staff/StaffShellSkeleton";
import { Badge } from "@/components/ui/Badge";
import { ease } from "@/components/ui/Motion";
import { cn } from "@/lib/cn";
import { useSignOut } from "@/lib/session/useSignOut";

// The admin panel's menu. One page for now; more go here as they're built.
const items = [{ key: "staff", href: "/", icon: IconUsers }] as const;

// The signed-in admin panel, in the staff dashboard's frame: the sidebar on the inline start (full on desktops, an
// icon rail on tablets, a slide-in menu on phones), the top bar, then the page. A gray frame while the session is
// checked.
export function AdminFrame({ children }: { children: ReactNode }) {
  return (
    <RequireAdmin loading={<StaffShellSkeleton groups={[items.length]} tools={false} />}>
      {(admin) => <AdminShell admin={admin}>{children}</AdminShell>}
    </RequireAdmin>
  );
}

function AdminShell({ admin, children }: { admin: Admin; children: ReactNode }) {
  const t = useTranslations("admin.nav");
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-dvh">
      <div className="sticky top-0 hidden h-dvh shrink-0 md:block xl:hidden">
        <Sidebar admin={admin} rail />
      </div>
      <div className="sticky top-0 hidden h-dvh shrink-0 xl:block">
        <Sidebar admin={admin} rail={false} />
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
              admin={admin}
              rail={false}
              onNavigate={() => setMenuOpen(false)}
              className="w-75"
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-surface px-4 md:px-6">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label={t("openMenu")}
            className="inline-flex size-10 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:hidden"
          >
            <IconMenu2 aria-hidden className="size-5" stroke={1.75} />
          </button>
          {/* Which side of Terhal this is: the same frame as the dashboard, so it says so. */}
          <Badge tone="primary">{t("badge")}</Badge>
        </header>
        <motion.main
          initial={{ opacity: 0 }}
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

type SidebarProps = {
  admin: Admin;
  // The 72px icon column on tablets, or the full menu with labels.
  rail: boolean;
  onNavigate?: () => void;
  className?: string;
};

function Sidebar({ admin, rail, onNavigate, className }: SidebarProps) {
  const t = useTranslations("admin.nav");
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("label")}
      className={cn(
        "flex h-full flex-col gap-6 border-e border-border bg-surface pt-5 pb-4",
        rail ? "w-18 items-center px-3" : "w-66 px-4",
        className,
      )}
    >
      <Link
        href="/"
        onClick={onNavigate}
        className={cn("flex shrink-0 items-center py-0.5", !rail && "ps-2")}
      >
        {rail ? (
          <Image src={logoMark} alt={t("home")} className="h-6.25 w-7" priority />
        ) : (
          <Image src={logo} alt={t("home")} className="h-7.75 w-28" priority />
        )}
      </Link>

      <div
        className={cn(
          "flex min-h-0 w-full flex-1 flex-col gap-0.5 overflow-y-auto",
          rail && "items-center",
        )}
      >
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const label = t(item.key);
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              aria-label={rail ? label : undefined}
              title={rail ? label : undefined}
              className={cn(
                "relative flex shrink-0 items-center rounded-lg text-[0.8125rem] transition-colors outline-none",
                rail ? "size-9 justify-center" : "h-9 w-full gap-2.5 px-2.5",
                active
                  ? "bg-primary-soft font-medium text-primary"
                  : "text-foreground hover:bg-hover focus-visible:bg-hover",
              )}
            >
              <Icon aria-hidden className="size-4.5 shrink-0" stroke={1.75} />
              {!rail && <span className="min-w-0 flex-1 truncate">{label}</span>}
              {active && !rail && (
                <span
                  aria-hidden
                  className="absolute start-0 top-1/2 h-5 w-0.75 -translate-y-1/2 rounded-e-xs bg-primary"
                />
              )}
            </Link>
          );
        })}
      </div>

      <SidebarUser admin={admin} rail={rail} />
    </nav>
  );
}

// Who's signed in, and the way out. Admins have no account page, so the name isn't a link.
function SidebarUser({ admin, rail }: { admin: Admin; rail: boolean }) {
  const t = useTranslations("admin");
  const signOut = useSignOut("admin");
  const name = `${admin.firstName} ${admin.lastName}`;
  const out = (
    <button
      type="button"
      onClick={() => void signOut()}
      aria-label={t("signOut")}
      title={t("signOut")}
      className="rounded-md p-1 text-muted transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <DirectionalIcon icon={IconLogout} className="size-5" stroke={1.75} />
    </button>
  );

  if (rail) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-2 border-t border-border pt-3">
        <span title={name}>
          <Avatar firstName={admin.firstName} lastName={admin.lastName} />
        </span>
        {out}
      </div>
    );
  }

  return (
    <div className="flex w-full shrink-0 items-center gap-2.5 border-t border-border pt-3">
      <Avatar firstName={admin.firstName} lastName={admin.lastName} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{name}</span>
        <span className="truncate text-xs text-muted" dir="ltr">
          {admin.email}
        </span>
      </span>
      {out}
    </div>
  );
}
