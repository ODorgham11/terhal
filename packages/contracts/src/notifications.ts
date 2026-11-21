import { z } from "zod";

// What a notification says (N1). Bookers are emailed the first group; staff see the second in the dashboard's inbox.
export const bookerNotificationKinds = [
  "BOOKING_RECEIVED",
  "BOOKED_BY_STAFF",
  "TRIP_CONFIRMED",
  "DRIVER_ASSIGNED",
  "TRIP_REMINDER",
  "PRICE_PROPOSED",
  "PRICE_REMINDER",
  "TRIP_CANCELLED",
  "CANCELLATION_RECEIPT",
  "TRIP_COMPLETED",
] as const;

export const staffNotificationKinds = [
  "NEW_BOOKING",
  "PRICE_REQUESTED",
  "PRICE_ACCEPTED",
  "PRICE_DECLINED",
  "CANCELLED_BY_BOOKER",
  "CANCELLED_BY_SYSTEM",
  "TRIP_UNASSIGNED",
  "REPORT_SUBMITTED",
] as const;

export const notificationKinds = [...bookerNotificationKinds, ...staffNotificationKinds] as const;
export type NotificationKind = (typeof notificationKinds)[number];
export type BookerNotificationKind = (typeof bookerNotificationKinds)[number];

export const StaffNotificationKind = z.enum(staffNotificationKinds).meta({
  id: "StaffNotificationKind",
  description:
    "NEW_BOOKING: booked on the site. PRICE_REQUESTED: booked without a price. PRICE_ACCEPTED / PRICE_DECLINED: the booker answered a proposed price. CANCELLED_BY_BOOKER: cancelled on the site. CANCELLED_BY_SYSTEM: expired unconfirmed at its pickup time. TRIP_UNASSIGNED: picks up within 2 hours with no driver or office. REPORT_SUBMITTED: the driver sent their report.",
});

// One entry in a staff member's inbox, in their locale.
export const StaffNotification = z
  .object({
    id: z.string(),
    kind: StaffNotificationKind,
    title: z.string(),
    body: z.string(),
    trip: z
      .object({ id: z.string(), code: z.string() })
      .nullable()
      .meta({ description: "The trip it's about, to link to." }),
    readAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "StaffNotification" });
export type StaffNotification = z.infer<typeof StaffNotification>;

export const ListNotifications = z.object({
  unread: z
    .enum(["true", "false"], { error: "Unread must be true or false." })
    .transform((value) => value === "true")
    .optional()
    .meta({ description: "Only unread notifications." }),
  cursor: z
    .string({ error: "Cursor is required." })
    .min(1, "Cursor is required.")
    .optional()
    .meta({ description: "The previous page's nextCursor." }),
  limit: z.coerce
    .number({ error: "Limit must be a number." })
    .int("Limit must be a whole number.")
    .min(1, "Limit must be at least 1.")
    .max(100, "Limit must be 100 at most.")
    .default(30),
});
export type ListNotifications = z.output<typeof ListNotifications>;

export const UnreadCount = z.object({ count: z.number().int() }).meta({ id: "UnreadCount" });

export const ReadAllNotifications = z
  .object({ count: z.number().int().meta({ description: "How many were marked read." }) })
  .meta({ id: "ReadAllNotifications" });
