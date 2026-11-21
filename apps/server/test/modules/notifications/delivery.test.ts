import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deliver } from "../../../src/modules/notifications/application/delivery";
import { sweepOutbox } from "../../../src/modules/notifications/application/outbox";
import { fireReminder } from "../../../src/modules/notifications/application/reminders";
import { processNotificationJob } from "../../../src/modules/notifications/index";
import { prisma } from "../../../src/platform/db/prisma";
import { sendEmail } from "../../../src/platform/email/email";
import { queues, type JobData } from "../../../src/platform/jobs/queues";
import { resetDatabase } from "../../support/database";
import { resetRedis } from "../../support/redis";
import {
  act,
  bookedTrip,
  pickupIn,
  signedInCustomer,
  tripWorld,
  tripsStaff,
  type Agent,
  type TripWorld,
} from "../../support/trips";

// Sending (N4): the outbox sweep, deliveries with retries, and reminders as delayed jobs.

vi.mock("../../../src/platform/email/email", () => ({ sendEmail: vi.fn() }));

beforeEach(async () => {
  vi.mocked(sendEmail).mockReset();
  await Promise.all([resetDatabase(), resetRedis()]);
});

const HOUR = 60 * 60 * 1000;

// A job as the worker hands it over, on its attempt `attempt` of 6.
const job = (name: string, data: JobData["notifications"], attempt = 1) =>
  ({ name, data, id: name, attemptsMade: attempt - 1, opts: { attempts: 6 } }) as unknown as Job<
    JobData["notifications"]
  >;

const pendingEmails = () =>
  prisma.notificationDelivery.findMany({
    where: { channel: "EMAIL" },
    include: { notification: true },
    orderBy: { createdAt: "asc" },
  });

describe("delivery", () => {
  let world: TripWorld;
  let site: Agent;
  let email: string;
  beforeEach(async () => {
    world = await tripWorld();
    await tripsStaff();
    const signedIn = await signedInCustomer();
    site = signedIn.agent;
    email = signedIn.customer.email;
  });

  it("queues each pending delivery once, under its own id", async () => {
    await bookedTrip(site, world);
    const [delivery] = await pendingEmails();
    if (!delivery) throw new Error("No delivery.");

    expect(await sweepOutbox()).toMatchObject({ deliveries: 1 });
    expect(await sweepOutbox()).toMatchObject({ deliveries: 0 });
    const queued = await queues.notifications.getJob(`delivery.${delivery.id}`);
    expect(queued?.data).toEqual({ deliveryId: delivery.id });
    expect(queued?.opts).toMatchObject({
      attempts: 6,
      backoff: { type: "exponential", delay: 30_000 },
    });
    expect(await queues.notifications.getJobCounts("waiting")).toEqual({ waiting: 1 });
    expect(
      (await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } }))
        .queuedAt,
    ).not.toBeNull();

    // A delivery whose job was lost (Redis emptied) is queued again once it's stale.
    await resetRedis();
    expect(await sweepOutbox(new Date(Date.now() + 31 * 60_000))).toMatchObject({ deliveries: 1 });
    expect(await queues.notifications.getJob(`delivery.${delivery.id}`)).toBeDefined();
  });

  it("sends the email in the booker's language, once", async () => {
    vi.mocked(sendEmail).mockResolvedValue("resend-id-1");
    const { trip } = await bookedTrip(site, world);
    const [delivery] = await pendingEmails();
    if (!delivery) throw new Error("No delivery.");

    await processNotificationJob(job("deliver", { deliveryId: delivery.id }));
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [to, subject, text, options] = vi.mocked(sendEmail).mock.calls[0] ?? [];
    expect(to).toBe(email);
    expect(subject).toBe(`استلمنا حجزك ${trip.code}`);
    expect(text).toContain("من دجلة إلى سموحة");
    expect(options?.html).toContain('dir="rtl"');
    expect(options?.idempotencyKey).toBe(`delivery-${delivery.id}`);

    expect(
      await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
    ).toMatchObject({ status: "SENT", attempts: 1, providerId: "resend-id-1" });

    // Run again (at least once): nothing more is sent.
    await processNotificationJob(job("deliver", { deliveryId: delivery.id }));
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("records each failed attempt, and fails the delivery after the last", async () => {
    vi.mocked(sendEmail).mockRejectedValue(new Error("Resend is down"));
    await bookedTrip(site, world);
    const [delivery] = await pendingEmails();
    if (!delivery) throw new Error("No delivery.");
    const row = () => prisma.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });

    await expect(
      processNotificationJob(job("deliver", { deliveryId: delivery.id }, 1)),
    ).rejects.toThrow("Resend is down");
    expect(await row()).toMatchObject({
      status: "PENDING",
      attempts: 1,
      failureReason: "Resend is down",
      failedAt: null,
    });

    await expect(
      processNotificationJob(job("deliver", { deliveryId: delivery.id }, 6)),
    ).rejects.toThrow();
    const failed = await row();
    expect(failed).toMatchObject({ status: "FAILED", attempts: 2 });
    expect(failed.failedAt).not.toBeNull();

    // A failed delivery is never queued again.
    expect(await sweepOutbox(new Date(Date.now() + 60 * 60_000))).toMatchObject({ deliveries: 0 });
  });

  it("succeeds on a retry after a failure", async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("timeout")).mockResolvedValue(undefined);
    await bookedTrip(site, world);
    const [delivery] = await pendingEmails();
    if (!delivery) throw new Error("No delivery.");

    await expect(deliver(delivery.id, { final: false })).rejects.toThrow("timeout");
    expect(await deliver(delivery.id, { final: false })).toBe("sent");
    expect(
      await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
    ).toMatchObject({ status: "SENT", attempts: 2, failureReason: null });
  });
});

describe("reminder jobs", () => {
  let world: TripWorld;
  let staff: Agent;
  let staffId: string;
  let site: Agent;
  beforeEach(async () => {
    world = await tripWorld();
    const signedIn = await tripsStaff();
    staff = signedIn.agent;
    staffId = signedIn.staff.id;
    site = (await signedInCustomer()).agent;
  });

  const delayedIds = async () =>
    (await queues.notifications.getDelayed()).map((queued) => queued.id).sort();

  const ids = (tripId: string, entries: [string, Date][]) =>
    entries.map(([kind, at]) => `reminder.${kind}.${tripId}.${String(at.getTime())}`).sort();

  it("are queued, moved when the pickup changes and dropped on cancel", async () => {
    const pickup = pickupIn(72);
    const { trip } = await bookedTrip(site, world, { pickupDate: pickup.toISOString() });
    await act(staff, trip.id, "confirm");
    const before = (date: Date, hours: number) => new Date(date.getTime() - hours * HOUR);

    const now = new Date();
    expect(await sweepOutbox(now)).toMatchObject({ reminders: 2 });
    expect(await delayedIds()).toEqual(
      ids(trip.id, [
        ["PICKUP", before(pickup, 24)],
        ["UNASSIGNED", before(pickup, 2)],
      ]),
    );
    const queued = await queues.notifications.getJob(
      ids(trip.id, [["PICKUP", before(pickup, 24)]])[0] ?? "",
    );
    expect(queued?.opts.delay).toBe(before(pickup, 24).getTime() - now.getTime());
    // In step: nothing to do.
    expect(await sweepOutbox()).toMatchObject({ reminders: 0 });

    const later = pickupIn(96);
    await staff.request(`/v1/staff/trips/${trip.id}`, {
      method: "PATCH",
      json: { pickupDate: later.toISOString() },
    });
    expect(await sweepOutbox()).toMatchObject({ reminders: 2 });
    expect(await delayedIds()).toEqual(
      ids(trip.id, [
        ["PICKUP", before(later, 24)],
        ["UNASSIGNED", before(later, 2)],
      ]),
    );

    await act(staff, trip.id, "cancel", { reason: "DUPLICATE" });
    expect(await sweepOutbox()).toMatchObject({ reminders: 2 });
    expect(await delayedIds()).toEqual([]);
    expect(await prisma.notificationReminder.findMany({ where: { tripId: trip.id } })).toEqual([
      expect.objectContaining({ dueAt: null, queuedFor: null }),
      expect.objectContaining({ dueAt: null, queuedFor: null }),
    ]);
  });

  it("remind the booker when due, once, and queue the email straight away", async () => {
    const pickup = pickupIn(72);
    const { trip } = await bookedTrip(site, world, { pickupDate: pickup.toISOString() });
    await act(staff, trip.id, "confirm");
    const dueAt = new Date(pickup.getTime() - 24 * HOUR);

    await processNotificationJob(
      job("remind", { tripId: trip.id, kind: "PICKUP", dueAt: dueAt.toISOString() }),
    );
    const reminders = await prisma.notification.findMany({
      where: { tripId: trip.id, kind: "TRIP_REMINDER" },
      include: { deliveries: true },
    });
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.title).toBe(`تذكير: رحلتك ${trip.code} غدًا`);
    const deliveryId = reminders[0]?.deliveries[0]?.id ?? "";
    expect(await queues.notifications.getJob(`delivery.${deliveryId}`)).toBeDefined();
    expect(
      await prisma.notificationReminder.findUniqueOrThrow({
        where: { tripId_kind: { tripId: trip.id, kind: "PICKUP" } },
      }),
    ).toMatchObject({ dueAt: null, queuedFor: null });

    // A second run of the same job changes nothing.
    expect(await fireReminder(trip.id, "PICKUP", dueAt, dueAt)).toEqual([]);
    expect(
      await prisma.notification.count({ where: { tripId: trip.id, kind: "TRIP_REMINDER" } }),
    ).toBe(1);
  });

  it("send nothing for a job left at an old time", async () => {
    const pickup = pickupIn(72);
    const { trip } = await bookedTrip(site, world, { pickupDate: pickup.toISOString() });
    await act(staff, trip.id, "confirm");
    const old = new Date(pickup.getTime() - 25 * HOUR);
    expect(await fireReminder(trip.id, "PICKUP", old, old)).toEqual([]);
    expect(await prisma.notification.count({ where: { kind: "TRIP_REMINDER" } })).toBe(0);
  });

  it("warn staff of a trip still unassigned 2 hours before pickup", async () => {
    const pickup = pickupIn(72);
    const { trip } = await bookedTrip(site, world, { pickupDate: pickup.toISOString() });
    const dueAt = new Date(pickup.getTime() - 2 * HOUR);
    expect(await fireReminder(trip.id, "UNASSIGNED", dueAt, dueAt)).toEqual([]);
    expect(
      await prisma.notification.findMany({
        where: { tripId: trip.id, kind: "TRIP_UNASSIGNED" },
        select: { staffId: true, title: true },
      }),
    ).toEqual([{ staffId, title: `الرحلة ${trip.code} تنطلق قريبًا دون سائق` }]);
  });
});
