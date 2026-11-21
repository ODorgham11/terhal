import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../src/platform/db/prisma";
import { resetDatabase } from "../../support/database";
import { DASHBOARD_ORIGIN, createAgent } from "../../support/http";
import { resetRedis } from "../../support/redis";
import { json, tripsStaff, type Agent } from "../../support/trips";

// The staff inbox routes (N6).

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

interface Item {
  id: string;
  kind: string;
  title: string;
  trip: { id: string; code: string } | null;
  readAt: string | null;
  createdAt: string;
}
interface Page {
  data: Item[];
  nextCursor: string | null;
}

let seq = 0;
const notify = (staffId: string, minutesAgo: number, read = false) => {
  seq += 1;
  return prisma.notification.create({
    data: {
      staffId,
      kind: "NEW_BOOKING",
      locale: "en",
      dedupeKey: `inbox.${String(seq)}`,
      title: `New booking ${String(seq)}`,
      body: "Mona: Degla → Smouha",
      data: { tripId: `trip${String(seq)}`, code: `TRH-${String(seq).padStart(6, "2")}` },
      createdAt: new Date(Date.now() - minutesAgo * 60_000),
      readAt: read ? new Date() : null,
    },
  });
};

describe("the staff inbox", () => {
  let agent: Agent;
  let staffId: string;
  let otherId: string;
  beforeEach(async () => {
    const me = await tripsStaff();
    agent = me.agent;
    staffId = me.staff.id;
    otherId = (await tripsStaff(["trips"], "other@terhal.co")).staff.id;
  });

  const count = async () =>
    (await json<{ count: number }>(await agent.request("/v1/staff/notifications/unread-count")))
      .count;

  it("lists your own notifications, newest first, a page at a time", async () => {
    const oldest = await notify(staffId, 30);
    const middle = await notify(staffId, 20, true);
    const newest = await notify(staffId, 10);
    await notify(otherId, 5);

    const first = await json<Page>(await agent.request("/v1/staff/notifications?limit=2"));
    expect(first.data.map((item) => item.id)).toEqual([newest.id, middle.id]);
    expect(first.data[0]).toMatchObject({
      kind: "NEW_BOOKING",
      title: newest.title,
      trip: { id: expect.any(String) as string, code: expect.any(String) as string },
      readAt: null,
    });
    expect(first.nextCursor).toBe(middle.id);

    const second = await json<Page>(
      await agent.request(`/v1/staff/notifications?limit=2&cursor=${String(first.nextCursor)}`),
    );
    expect(second.data.map((item) => item.id)).toEqual([oldest.id]);
    expect(second.nextCursor).toBeNull();

    const unread = await json<Page>(await agent.request("/v1/staff/notifications?unread=true"));
    expect(unread.data.map((item) => item.id)).toEqual([newest.id, oldest.id]);
  });

  it("counts and marks them read, one or all", async () => {
    const one = await notify(staffId, 3);
    await notify(staffId, 2);
    await notify(staffId, 1);
    const theirs = await notify(otherId, 1);
    expect(await count()).toBe(3);

    const read = await agent.request(`/v1/staff/notifications/${one.id}/read`, { method: "POST" });
    expect(read.status).toBe(200);
    const readAt = (await json<Item>(read)).readAt;
    expect(readAt).not.toBeNull();
    expect(await count()).toBe(2);

    // Again: the first read time stays.
    const again = await agent.request(`/v1/staff/notifications/${one.id}/read`, { method: "POST" });
    expect((await json<Item>(again)).readAt).toBe(readAt);

    // Someone else's is not found.
    const notMine = await agent.request(`/v1/staff/notifications/${theirs.id}/read`, {
      method: "POST",
    });
    expect(notMine.status).toBe(404);
    expect((await json<{ code: string }>(notMine)).code).toBe("NOT_FOUND");

    const all = await agent.request("/v1/staff/notifications/read-all", { method: "POST" });
    expect(await json(all)).toEqual({ count: 2 });
    expect(await count()).toBe(0);
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt,
    ).toBeNull();
  });

  it("needs a signed in staff member", async () => {
    const anonymous = createAgent(DASHBOARD_ORIGIN);
    expect((await anonymous.request("/v1/staff/notifications/unread-count")).status).toBe(401);
  });

  it("counts unread with the partial index", async () => {
    // An empty table is scanned whatever the indexes, so rule that out.
    const [, plan] = await prisma.$transaction([
      prisma.$executeRawUnsafe("SET LOCAL enable_seqscan = off"),
      prisma.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
        `EXPLAIN SELECT count(*) FROM "Notification" WHERE "staffId" = $1 AND "readAt" IS NULL`,
        staffId,
      ),
    ]);
    expect(plan.map((row) => row["QUERY PLAN"]).join("\n")).toContain("Notification_staff_unread");
  });
});
