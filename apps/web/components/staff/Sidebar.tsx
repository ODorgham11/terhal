"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { IconLogout } from "@tabler/icons-react";
import type { Staff } from "@terhal/contracts";
import logo from "@/assets/logo.png";
import logoMark from "@/assets/logo-mark.png";
import { cn } from "@/lib/cn";
import { useSignOut } from "@/lib/session/useSignOut";
import { DirectionalIcon } from "@/components/DirectionalIcon";
import { Avatar } from "./Avatar";
import { isActive, visibleGroups, type NavItem } from "./nav";
import { overviewQuery } from "./queries";

type SidebarProps = {
  staff: Staff;
  // "rail" is the 72px icon column (tablets); "full" has the labels (desktop and the mobile menu).
  variant: "full" | "rail";
  // Called after a link is followed: the mobile menu closes itself.
  onNavigate?: () => void;
  className?: string;
};

// The staff dashboard's navigation, on the inline start. Items the staff member has no permission for are hidden.
export function Sidebar({ staff, variant, onNavigate, className }: SidebarProps) {
  const t = useTranslations("staff.nav");
  const pathname = usePathname();
  const rail = variant === "rail";
  const groups = visibleGroups(staff.permissions);

  // Trips carries the number of trips still waiting for a driver.
  const overview = useQuery({ ...overviewQuery, enabled: staff.permissions.includes("trips") });
  const counts: Partial<Record<NavItem["key"], number>> = { trips: overview.data?.unassigned };

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

      <div className="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.key} className={cn("flex flex-col gap-0.5", rail && "items-center")}>
            {group.key !== "main" &&
              (rail ? (
                <div aria-hidden className="mb-1 h-px w-8 bg-border" />
              ) : (
                <p className="px-3 pb-1 text-xs font-medium text-muted">
                  {t(`groups.${group.key}`)}
                </p>
              ))}
            {group.items.map((item) => (
              <SidebarLink
                key={item.key}
                item={item}
                label={t(item.key)}
                count={counts[item.key]}
                active={isActive(item.href, pathname)}
                rail={rail}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
      </div>

      <SidebarUser staff={staff} rail={rail} onNavigate={onNavigate} />
    </nav>
  );
}

type SidebarLinkProps = {
  item: NavItem;
  label: string;
  count: number | undefined;
  active: boolean;
  rail: boolean;
  onNavigate?: () => void;
};

function SidebarLink({ item, label, count, active, rail, onNavigate }: SidebarLinkProps) {
  const t = useTranslations("staff.nav");
  const Icon = item.icon;
  const showCount = count !== undefined && count > 0;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      // The rail shows icons only, so the name is the link's label and its tooltip.
      aria-label={rail ? label : undefined}
      title={rail ? label : undefined}
      className={cn(
        "relative flex shrink-0 items-center rounded-lg text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        rail ? "size-10 justify-center" : "h-10 w-full gap-3 px-3",
        active
          ? "bg-primary-soft font-medium text-primary"
          : "text-foreground hover:bg-surface-muted",
      )}
    >
      <Icon aria-hidden className="size-5 shrink-0" stroke={1.75} />
      {!rail && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {showCount &&
        (rail ? (
          <span aria-hidden className="absolute end-2 top-2 size-2 rounded-full bg-accent" />
        ) : (
          <span className="rounded-full bg-accent px-1.5 text-xs leading-4 font-medium text-primary-foreground">
            {count}
            <span className="sr-only"> {t("unassignedCount")}</span>
          </span>
        ))}
      {active && !rail && (
        <span
          aria-hidden
          className="absolute start-0 top-1/2 h-5 w-0.75 -translate-y-1/2 rounded-e-xs bg-primary"
        />
      )}
    </Link>
  );
}

function SidebarUser({
  staff,
  rail,
  onNavigate,
}: {
  staff: Staff;
  rail: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations("staff.nav");
  const signOut = useSignOut("staff");
  const name = `${staff.firstName} ${staff.lastName}`;

  if (rail) {
    return (
      <div className="flex shrink-0 justify-center border-t border-border pt-3">
        <Link
          href="/account"
          onClick={onNavigate}
          aria-label={t("account")}
          title={name}
          className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Avatar firstName={staff.firstName} lastName={staff.lastName} />
        </Link>
      </div>
    );
  }

  return (
    <div className="flex w-full shrink-0 items-center gap-2.5 border-t border-border pt-3">
      <Link
        href="/account"
        onClick={onNavigate}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Avatar firstName={staff.firstName} lastName={staff.lastName} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
          <span className="truncate text-xs text-muted" dir="ltr">
            {staff.email}
          </span>
        </span>
      </Link>
      <button
        type="button"
        onClick={() => void signOut()}
        aria-label={t("signOut")}
        title={t("signOut")}
        className="rounded-md p-1 text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <DirectionalIcon icon={IconLogout} className="size-5" stroke={1.75} />
      </button>
    </div>
  );
}
