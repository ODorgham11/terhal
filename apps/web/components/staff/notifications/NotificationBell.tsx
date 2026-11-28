"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Popover } from "radix-ui";
import { IconBell } from "@tabler/icons-react";
import { Button } from "@/components/ui/Button";
import { AutoHeight, fade } from "@/components/ui/Motion";
import { call, staffApi } from "@/lib/api";
import { unreadCountQuery } from "../queries";
import { NotificationItem, NotificationsLoading, notificationsKey } from "./NotificationItem";

const PAGE = 5;

// The top bar's bell: a dot while anything is unread, and the latest few in a panel.
export function NotificationBell() {
  const t = useTranslations("staff.notifications");
  const top = useTranslations("staff.topBar");
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const unread = useQuery(unreadCountQuery);
  const count = unread.data?.count ?? 0;
  // A few at a time, more on asking, inside a panel that scrolls and never grows past the window.
  const latest = useInfiniteQuery({
    queryKey: [...notificationsKey, "latest"],
    queryFn: ({ pageParam }) =>
      call(
        staffApi.notifications.$get({
          query: { limit: String(PAGE), ...(pageParam && { cursor: pageParam }) },
        }),
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: open,
  });
  const rows = latest.data?.pages.flatMap((page) => page.data) ?? [];

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
          collisionPadding={16}
          className="animate-popover z-50 flex max-h-[min(34rem,var(--radix-popover-content-available-height))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
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
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <AutoHeight>
              {latest.isPending ? (
                <NotificationsLoading rows={3} />
              ) : latest.isError ? (
                <p className="p-6 text-center text-sm text-danger">{t("loadFailed")}</p>
              ) : rows.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted">{t("empty")}</p>
              ) : (
                <div className="divide-y divide-border">
                  {rows.map((notification) => (
                    <motion.div key={notification.id} {...fade}>
                      <NotificationItem
                        notification={notification}
                        compact
                        onOpen={() => setOpen(false)}
                      />
                    </motion.div>
                  ))}
                  {latest.hasNextPage && (
                    <div className="flex justify-center px-4 py-2.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={latest.isFetchingNextPage}
                        onClick={() => void latest.fetchNextPage()}
                      >
                        {t("showMore")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </AutoHeight>
          </div>
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="shrink-0 border-t border-border px-4 py-3 text-center text-sm font-medium text-primary hover:bg-hover"
          >
            {t("seeAll")}
          </Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
