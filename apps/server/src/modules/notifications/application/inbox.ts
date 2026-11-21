import type { ListNotifications, StaffNotification } from "@terhal/contracts";
import type { Notification } from "../../../../generated/prisma/client";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";

// A staff member's inbox (N6): newest first, with an unread count cheap enough to poll every 30 seconds (one count over
// the Notification_staff_unread partial index).

const toStaffNotification = (row: Notification): StaffNotification => {
  const data = row.data as { tripId?: string; code?: string } | null;
  return {
    id: row.id,
    kind: row.kind as StaffNotification["kind"],
    title: row.title,
    body: row.body,
    trip: data?.tripId && data.code ? { id: data.tripId, code: data.code } : null,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
};

export const listNotifications = async (
  staffId: string,
  { unread, cursor, limit }: ListNotifications,
) => {
  const rows = await prisma.notification.findMany({
    where: { staffId, ...(unread && { readAt: null }) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });
  return {
    data: rows.slice(0, limit).map(toStaffNotification),
    nextCursor: rows.length > limit ? (rows[limit - 1]?.id ?? null) : null,
  };
};

export const unreadCount = async (staffId: string) => ({
  count: await prisma.notification.count({ where: { staffId, readAt: null } }),
});

const notFound = () =>
  new AppError({ code: "NOT_FOUND", status: 404, detail: "There's no such notification." });

// Reading one already read keeps its first read time.
export const markRead = async (staffId: string, id: string, now = new Date()) => {
  await prisma.notification.updateMany({
    where: { id, staffId, readAt: null },
    data: { readAt: now },
  });
  const row = await prisma.notification.findFirst({ where: { id, staffId } });
  if (!row) throw notFound();
  return toStaffNotification(row);
};

export const markAllRead = async (staffId: string, now = new Date()) => {
  const { count } = await prisma.notification.updateMany({
    where: { staffId, readAt: null },
    data: { readAt: now },
  });
  return { count };
};
