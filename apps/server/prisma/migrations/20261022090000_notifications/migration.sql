-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WHATSAPP', 'IN_APP', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('BOOKING_RECEIVED', 'BOOKED_BY_STAFF', 'TRIP_CONFIRMED', 'DRIVER_ASSIGNED', 'TRIP_REMINDER', 'PRICE_PROPOSED', 'PRICE_REMINDER', 'TRIP_CANCELLED', 'CANCELLATION_RECEIPT', 'TRIP_COMPLETED', 'NEW_BOOKING', 'PRICE_REQUESTED', 'PRICE_ACCEPTED', 'PRICE_DECLINED', 'CANCELLED_BY_BOOKER', 'CANCELLED_BY_SYSTEM', 'TRIP_UNASSIGNED', 'REPORT_SUBMITTED');

-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('PICKUP', 'PRICE', 'UNASSIGNED');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "guestSessionId" TEXT,
    "staffId" TEXT,
    "kind" "NotificationKind" NOT NULL,
    "locale" "Locale" NOT NULL,
    "tripId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "recipient" TEXT,
    "providerId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "queuedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationReminder" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "dueAt" TIMESTAMP(3),
    "queuedFor" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_customerId_idx" ON "Notification"("customerId");

-- CreateIndex
CREATE INDEX "Notification_guestSessionId_idx" ON "Notification"("guestSessionId");

-- CreateIndex
CREATE INDEX "Notification_staffId_createdAt_id_idx" ON "Notification"("staffId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Notification_tripId_idx" ON "Notification"("tripId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_notificationId_idx" ON "NotificationDelivery"("notificationId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_providerId_idx" ON "NotificationDelivery"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationReminder_tripId_kind_key" ON "NotificationReminder"("tripId", "kind");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_guestSessionId_fkey" FOREIGN KEY ("guestSessionId") REFERENCES "GuestSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationReminder" ADD CONSTRAINT "NotificationReminder_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A notification goes to exactly one of a customer, a guest and a staff member. Prisma can't express this, so the database holds it.
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_one_recipient"
    CHECK (num_nonnulls("customerId", "guestSessionId", "staffId") = 1);

-- Only staff have an inbox (N3 a), so only a staff notification can be read there.
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_read_by_staff"
    CHECK ("readAt" IS NULL OR "staffId" IS NOT NULL);

-- A delivery's attempts never go below zero.
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_attempts"
    CHECK ("attempts" >= 0);

-- The dashboard polls each staff member's unread count every 30 seconds (N6 a): this keeps it to a scan of their unread
-- rows only, which reading empties.
CREATE INDEX "Notification_staff_unread" ON "Notification" ("staffId") WHERE "readAt" IS NULL AND "staffId" IS NOT NULL;

-- The worker's outbox sweep looks for deliveries still waiting to be queued, every few seconds.
CREATE INDEX "NotificationDelivery_unqueued" ON "NotificationDelivery" ("createdAt") WHERE "status" = 'PENDING';

-- And for reminders whose queued job doesn't match when they're due (moved, dropped or never queued).
CREATE INDEX "NotificationReminder_unsynced" ON "NotificationReminder" ("updatedAt")
    WHERE "dueAt" IS DISTINCT FROM "queuedFor" OR "queuedFor" IS NOT NULL;
