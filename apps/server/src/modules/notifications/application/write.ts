import type { Prisma } from "../../../../generated/prisma/client";
import type { Planned } from "../domain/rules";
import { renderNotification, type NoticeData } from "../domain/templates";
import type { Db, NotifiableTrip, Recipient } from "./trips";

// Writes planned notifications: the booker's as a Notification with a pending EMAIL delivery (the outbox the worker
// sends from, N3 a: customers get email only), staff's as inbox entries, each in its recipient's locale (N5 a).

const recipientKey = (recipient: Recipient | { staffId: string }) =>
  "customerId" in recipient
    ? `customer.${recipient.customerId}`
    : "guestSessionId" in recipient
      ? `guest.${recipient.guestSessionId}`
      : `staff.${recipient.staffId}`;

// Every active staff member who runs trips (`trips`), except the one who acted: they know.
const tripsStaff = (db: Db, exceptStaffId: string | null) =>
  db.staff.findMany({
    where: {
      status: "ACTIVE",
      permissions: { array_contains: ["trips"] },
      ...(exceptStaffId && { id: { not: exceptStaffId } }),
    },
    select: { id: true, locale: true },
  });

export interface Write {
  trip: NotifiableTrip;
  planned: Planned;
  data: NoticeData;
  // Names the cause, e.g. `event.<id>`; the recipient is appended. The same cause never notifies anyone twice.
  cause: (kind: string) => string;
  exceptStaffId?: string | null;
}

// Returns the new deliveries' ids, for a caller outside a transaction to queue straight away.
export const writeNotifications = async (db: Db, write: Write): Promise<string[]> => {
  const { trip, planned, data } = write;
  const deliveries: string[] = [];

  if (planned.booker && trip.booker) {
    const booker = trip.booker;
    const kind = planned.booker;
    const { title, body } = renderNotification(kind, booker.locale, data);
    const [created] = await db.notification.createManyAndReturn({
      data: [
        {
          ...("customerId" in booker
            ? { customerId: booker.customerId }
            : { guestSessionId: booker.guestSessionId }),
          kind,
          locale: booker.locale,
          tripId: trip.id,
          dedupeKey: `${write.cause(kind)}.${recipientKey(booker)}`,
          title,
          body,
          data: data as unknown as Prisma.InputJsonValue,
        },
      ],
      skipDuplicates: true,
      select: { id: true },
    });
    if (created) {
      const delivery = await db.notificationDelivery.create({
        data: { notificationId: created.id, channel: "EMAIL", recipient: booker.email },
        select: { id: true },
      });
      deliveries.push(delivery.id);
    }
  }

  if (planned.staff) {
    const kind = planned.staff;
    const staff = await tripsStaff(db, write.exceptStaffId ?? null);
    if (staff.length > 0) {
      await db.notification.createMany({
        data: staff.map((member) => {
          const { title, body } = renderNotification(kind, member.locale, data);
          return {
            staffId: member.id,
            kind,
            locale: member.locale,
            tripId: trip.id,
            dedupeKey: `${write.cause(kind)}.${recipientKey({ staffId: member.id })}`,
            title,
            body,
            data: { tripId: trip.id, code: data.code },
          };
        }),
        skipDuplicates: true,
      });
    }
  }

  return deliveries;
};
