import { prisma } from "../../../platform/db/prisma";
import { sendEmail } from "../../../platform/email/email";
import { renderNotification, type NoticeData } from "../domain/templates";

// Sends one delivery (N4). Runs as a job, at least once: a row that's no longer pending is left alone, and Resend's
// idempotency key (the delivery's id) makes a retry after a send that went through but wasn't recorded a no-op. Every
// attempt is counted on the row with its error; the last one marks it FAILED, until then it stays PENDING.

export type Send = typeof sendEmail;

export interface Attempt {
  // No retry follows this one if it fails.
  final: boolean;
}

export const deliver = async (
  deliveryId: string,
  attempt: Attempt,
  send: Send = sendEmail,
  now = () => new Date(),
): Promise<"sent" | "skipped"> => {
  const delivery = await prisma.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: { notification: true },
  });
  if (delivery?.status !== "PENDING" || delivery.channel !== "EMAIL" || !delivery.recipient) {
    return "skipped";
  }

  await prisma.notificationDelivery.update({
    where: { id: deliveryId },
    data: { attempts: { increment: 1 } },
  });

  const { notification } = delivery;
  const { html } = renderNotification(
    notification.kind,
    notification.locale,
    notification.data as unknown as NoticeData,
  );
  try {
    const providerId = await send(delivery.recipient, notification.title, notification.body, {
      html,
      idempotencyKey: `delivery-${deliveryId}`,
    });
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: { status: "SENT", sentAt: now(), providerId: providerId ?? null, failureReason: null },
    });
    return "sent";
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        failureReason: reason.slice(0, 1000),
        ...(attempt.final && { status: "FAILED", failedAt: now() }),
      },
    });
    throw error;
  }
};
