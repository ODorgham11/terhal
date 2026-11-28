"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { IconBellOff, IconChecks } from "@tabler/icons-react";
import { RequireStaff } from "@/components/session/RequireSession";
import { ListPagination, useCursorList } from "@/components/staff/CursorList";
import {
  NotificationItem,
  NotificationsLoading,
  notificationsKey,
} from "@/components/staff/notifications/NotificationItem";
import { unreadCountQuery } from "@/components/staff/queries";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { FadeText, Swap, fade } from "@/components/ui/Motion";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { toast } from "@/components/ui/Toast";
import { call, staffApi, useErrorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

export function NotificationsPage() {
  return <RequireStaff>{() => <Inbox />}</RequireStaff>;
}

type Flag = "true" | "false";

function Inbox() {
  const t = useTranslations("staff.notifications");
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const unread = useQuery(unreadCountQuery);
  const [busy, setBusy] = useState(false);
  const inbox = useCursorList(
    [...notificationsKey, "inbox"],
    { unread: "" as Flag | "" },
    (query) => call(staffApi.notifications.$get({ query })),
    20,
  );
  const { filters, setFilter, rows, result } = inbox;
  const count = unread.data?.count ?? 0;
  // The last tab's notifications stay up, dimmed, until the new ones arrive.
  const stale = result.isPlaceholderData;

  const readAll = async () => {
    setBusy(true);
    try {
      await call(staffApi.notifications["read-all"].$post());
      await client.invalidateQueries({ queryKey: notificationsKey });
      toast.success(t("allRead"));
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <AnimatePresence initial={false}>
            {count > 0 && (
              <motion.span key="read-all" {...fade}>
                <Button variant="secondary" onClick={() => void readAll()} loading={busy}>
                  <IconChecks aria-hidden className="size-5" stroke={1.75} />
                  {t("markAllRead")}
                </Button>
              </motion.span>
            )}
          </AnimatePresence>
        }
      />
      <Tabs
        value={filters.unread || "all"}
        onValueChange={(value) => setFilter("unread", value === "all" ? "" : "true")}
      >
        <TabsList>
          <TabsTrigger value="all">{t("all")}</TabsTrigger>
          <TabsTrigger value="true">
            {t("unread")}
            {count > 0 && (
              <span className="ms-1.5 text-xs text-muted tabular-nums">
                <FadeText value={count} />
              </span>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div
        aria-busy={result.isFetching || undefined}
        className={cn(
          "overflow-hidden rounded-xl border border-border bg-surface shadow-xs transition-opacity",
          stale && "opacity-60",
        )}
      >
        <Swap
          state={
            result.isPending
              ? "loading"
              : result.isError
                ? "error"
                : rows.length === 0
                  ? `empty-${filters.unread}`
                  : "rows"
          }
        >
          {result.isPending ? (
            <NotificationsLoading />
          ) : result.isError ? (
            <p className="p-8 text-center text-sm text-danger">{errorMessage(result.error)}</p>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={IconBellOff}
              title={filters.unread ? t("noUnread") : t("empty")}
              description={t("emptyHint")}
            />
          ) : (
            <div className="divide-y divide-border">
              {rows.map((notification) => (
                <motion.div key={notification.id} {...fade}>
                  <NotificationItem notification={notification} />
                </motion.div>
              ))}
            </div>
          )}
        </Swap>
      </div>
      <ListPagination list={inbox} />
    </>
  );
}
