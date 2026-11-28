"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { IconMenu2, IconSearch } from "@tabler/icons-react";
import type { Staff } from "@terhal/contracts";
import { Input } from "@/components/ui/Input";
import { NotificationBell } from "./notifications/NotificationBell";

type TopBarProps = {
  staff: Staff;
  // Opens the mobile menu; the button only shows below md, where the sidebar is hidden.
  onOpenMenu: () => void;
};

// Search by trip code at the inline start, notifications at the end. On phones: the menu button instead of the search.
export function TopBar({ staff, onOpenMenu }: TopBarProps) {
  const t = useTranslations("staff.topBar");
  const router = useRouter();
  const [query, setQuery] = useState("");

  const search = (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    router.push(`/trips?q=${encodeURIComponent(q)}`);
    setQuery("");
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-surface px-4 md:px-6">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label={t("openMenu")}
        className="inline-flex size-10 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:hidden"
      >
        <IconMenu2 aria-hidden className="size-5" stroke={1.75} />
      </button>

      {staff.permissions.includes("trips") && (
        <form role="search" onSubmit={search} className="hidden w-90 md:block">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("search")}
            startAdornment={<IconSearch aria-hidden className="size-4.5" stroke={1.75} />}
          />
        </form>
      )}

      <div className="flex-1" />

      <NotificationBell />
    </header>
  );
}
