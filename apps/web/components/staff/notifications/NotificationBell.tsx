"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Popover } from "radix-ui";
import { IconBell } from "@tabler/icons-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { call, staffApi } from "@/lib/api";
import { unreadCountQuery } from "../queries";
import { NotificationItem, notificationsKey } from "./NotificationItem";

// The top bar's bell: a dot while anything is unread, and the latest few in a panel.
export function NotificationBell() {
  const t = useTranslations("staff.notifications");
  const top = useTranslations("staff.topBar");
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const unread = useQuery(unreadCountQuery);
  const count = unread.data?.count ?? 0;
  const latest = useQuery({
    queryKey: [...notificationsKey, "latest"],
    queryFn: () => call(staffApi.notifications.$get({ query: { limit: "6" } })),
    enabled: open,
  });

  const readAll = async () => {
    await call(staffApi.notifications["read-all"].$post());
    await client.invalidateQueries({ queryKey: notificationsKey });
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={count > 0 ? top("notificationsUnread", { count }) : top("notifications")}
        className="relative inline-flex size-10 items-center justify-center rounded-lg bg-surface-muted text-foreground transition-colors hover:bg-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <IconBell aria-hidden className="size-5" stroke={1.75} />
        {count > 0 && (
          <span
            aria-hidden
            className="absolute end-2.5 top-2.5 size-2 rounded-full bg-accent ring-2 ring-surface-muted"
          />
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-foreground">{t("title")}</p>
            {count > 0 && (
              <button
                type="button"
                onClick={() => void readAll()}
                className="text-xs text-primary hover:underline"
              >
                {t("markAllRead")}
              </button>
            )}
          </div>
          <div className="max-h-[26rem] divide-y divide-border overflow-y-auto">
            {latest.isPending ? (
              <div className="flex flex-col gap-3 p-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : latest.isError ? (
              <p className="p-6 text-center text-sm text-muted">{t("loadFailed")}</p>
            ) : latest.data.data.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted">{t("empty")}</p>
            ) : (
              latest.data.data.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  compact
                  onOpen={() => setOpen(false)}
                />
              ))
            )}
          </div>
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="border-t border-border px-4 py-3 text-center text-sm font-medium text-primary hover:bg-surface-muted/60"
          >
            {t("seeAll")}
          </Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
