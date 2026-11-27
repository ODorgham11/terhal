"use client";

import Link from "next/link";
import { useFormatter, useNow } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconCalendarPlus,
  IconCash,
  IconCircleCheck,
  IconCircleX,
  IconFileText,
  IconQuestionMark,
  type Icon,
} from "@tabler/icons-react";
import type { StaffNotification } from "@terhal/contracts";
import { call, staffApi } from "@/lib/api";
import { cn } from "@/lib/cn";

const looks: Record<StaffNotification["kind"], { icon: Icon; tone: string }> = {
  NEW_BOOKING: { icon: IconCalendarPlus, tone: "bg-primary-soft text-primary" },
  PRICE_REQUESTED: { icon: IconQuestionMark, tone: "bg-warning-soft text-warning" },
  PRICE_ACCEPTED: { icon: IconCash, tone: "bg-success-soft text-success" },
  PRICE_DECLINED: { icon: IconCircleX, tone: "bg-danger-soft text-danger" },
  CANCELLED_BY_BOOKER: { icon: IconCircleX, tone: "bg-danger-soft text-danger" },
  CANCELLED_BY_SYSTEM: { icon: IconCircleX, tone: "bg-surface-muted text-muted" },
  TRIP_UNASSIGNED: { icon: IconAlertTriangle, tone: "bg-accent-soft text-accent-strong" },
  REPORT_SUBMITTED: { icon: IconFileText, tone: "bg-info-soft text-info" },
};

export const notificationsKey = ["staff", "notifications"] as const;

// Marks it read (once) and refreshes the badge and the lists.
export function useMarkRead() {
  const client = useQueryClient();
  return async (notification: StaffNotification) => {
    if (notification.readAt) return;
    await call(staffApi.notifications[":id"].read.$post({ param: { id: notification.id } }));
    await client.invalidateQueries({ queryKey: notificationsKey });
  };
}

type Props = { notification: StaffNotification; compact?: boolean; onOpen?: () => void };

// One notification: what happened, when, and a link to the trip it's about. Unread ones are tinted and dotted.
export function NotificationItem({ notification, compact, onOpen }: Props) {
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const markRead = useMarkRead();
  const { icon: KindIcon, tone } = looks[notification.kind];
  const unread = notification.readAt === null;
  const open = () => {
    void markRead(notification);
    onOpen?.();
  };

  const body = (
    <>
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", tone)}>
        <KindIcon aria-hidden className="size-4.5" stroke={1.75} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("text-sm text-foreground", unread && "font-medium")}>
          {notification.title}
        </span>
        <span className={cn("text-xs text-muted", compact && "line-clamp-2")}>
          {notification.body}
        </span>
        <span className="text-xs text-muted">
          {format.relativeTime(new Date(notification.createdAt), now)}
        </span>
      </span>
      {unread && <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />}
    </>
  );
  const classes = cn(
    "flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-surface-muted/60",
    unread && "bg-primary-soft/30",
  );

  return notification.trip ? (
    <Link href={`/trips/${notification.trip.id}`} onClick={open} className={classes}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={open} className={classes}>
      {body}
    </button>
  );
}
