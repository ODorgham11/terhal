import type { AnalyticsReport, AnalyticsReportLink } from "@terhal/contracts";
import ExcelJS from "exceljs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  MONTHLY_REPORT_JOB,
  generateDueReport,
  generateReport,
  monthlyReportSchedule,
  processAnalyticsJob,
  scheduleAnalyticsJobs,
} from "../../../src/modules/analytics/application/reports";
import { prisma } from "../../../src/platform/db/prisma";
import { queues } from "../../../src/platform/jobs/queues";
import { storage } from "../../../src/platform/storage/index";
import { analyticsTrip } from "../../support/analytics";
import { resetDatabase } from "../../support/database";
import { createAgent } from "../../support/http";
import { resetRedis } from "../../support/redis";
import { signedInStaff } from "../../support/staff-agents";
import { fleet } from "../../support/trips";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

afterAll(async () => {
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
});

const json = async <Body>(response: Response) => (await response.json()) as Body;

// October 2026 in Cairo: a completed office trip with expenses, a cancelled trip, a ledger entry.
const october = async () => {
  const office = await prisma.office.create({
    data: { name: "Delta Cars", contact: "Hany", phone: "+201000000001", address: "Tanta" },
  });
  const done = await analyticsTrip({
    status: "COMPLETED",
    pickupDate: "2026-10-10T08:00:00Z",
    totalPrice: "1200.00",
    officeId: office.id,
    clientName: "=cmd()",
    expenses: [
      { type: "FUEL", amount: "150.00" },
      { type: "OFFICE_FEE", amount: "400.00" },
    ],
  });
  await analyticsTrip({ status: "CANCELLED", pickupDate: "2026-10-12T08:00:00Z" });
  // 1 November in Cairo: not October's.
  await analyticsTrip({ status: "COMPLETED", pickupDate: "2026-10-31T22:30:00Z" });
  const { driver } = await fleet();
  await prisma.driverTransaction.create({
    data: {
      driverId: driver.id,
      type: "ADJUSTMENT",
      amount: "75.00",
      note: "Bonus",
      createdAt: new Date("2026-10-15T12:00:00Z"),
    },
  });
  return { done, office, driver };
};

const workbookAt = async (link: AnalyticsReportLink) => {
  const url = new URL(link.url);
  const response = await createAgent().request(url.pathname + url.search);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await response.arrayBuffer());
  return workbook;
};

const values = (sheet: ExcelJS.Worksheet | undefined) => {
  const rows: unknown[][] = [];
  sheet?.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return rows;
};

describe("monthly reports", () => {
  it("generates a month's workbook into storage and lists it with a download link", async () => {
    const { agent } = await signedInStaff(["analytics"]);
    const { done, office, driver } = await october();

    const generated = await agent.request("/v1/staff/analytics/reports/2026/10/regenerate", {
      method: "POST",
    });
    expect(generated.status).toBe(200);
    const report = await json<AnalyticsReport>(generated);
    expect(report).toMatchObject({ year: 2026, month: 10 });
    expect(report.size).toBeGreaterThan(0);
    expect(
      await prisma.analyticsDocument.findUniqueOrThrow({
        where: { year_month: { year: 2026, month: 10 } },
      }),
    ).toMatchObject({
      bucket: storage.bucket,
      key: "analytics/reports/2026-10.xlsx",
      size: report.size,
    });

    const list = await json<{ data: AnalyticsReport[]; nextCursor: null }>(
      await agent.request("/v1/staff/analytics/reports"),
    );
    expect(list).toEqual({ data: [report], nextCursor: null });

    const linked = await agent.request("/v1/staff/analytics/reports/2026/10");
    expect(linked.status).toBe(200);
    const link = await json<AnalyticsReportLink>(linked);
    expect(link).toMatchObject({ year: 2026, month: 10 });
    expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);

    const workbook = await workbookAt(link);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Summary",
      "Trips",
      "Expenses",
      "Driver transactions",
      "Office fees",
    ]);
    const summary = values(workbook.getWorksheet("Summary"));
    expect(summary[0]).toEqual(["Terhal report, 2026-10"]);
    expect(summary).toContainEqual(["Trips", 2]);
    expect(summary).toContainEqual(["Revenue (completed trips)", 1200]);
    expect(summary).toContainEqual(["Expenses (completed trips)", 550]);
    expect(summary).toContainEqual(["Margin", 650]);
    expect(summary).toContainEqual(["Office fees", 400]);

    const trips = values(workbook.getWorksheet("Trips"));
    expect(trips).toHaveLength(3);
    expect(trips[1]?.[0]).toBe(done.code);
    // Cells are values, never formulas; amounts are numbers.
    expect(trips[1]?.[12]).toBe("=cmd()");
    expect(trips[1]?.[19]).toBe(1200);

    const expenses = values(workbook.getWorksheet("Expenses"));
    expect(expenses).toHaveLength(3);
    expect(values(workbook.getWorksheet("Office fees"))[1]).toEqual([
      office.name,
      done.code,
      "COMPLETED",
      "2026-10-10 11:00",
      400,
    ]);
    expect(values(workbook.getWorksheet("Driver transactions"))[1]).toEqual([
      "2026-10-15 15:00",
      `${driver.firstName} ${driver.lastName}`,
      driver.phone,
      "ADJUSTMENT",
      75,
      undefined,
      undefined,
      "Bonus",
    ]);
  });

  it("regenerates in place: one row, one file, the figures as they are now", async () => {
    const { agent } = await signedInStaff(["analytics"]);
    const { done } = await october();
    const regenerate = () =>
      agent.request("/v1/staff/analytics/reports/2026/10/regenerate", { method: "POST" });

    const first = await json<AnalyticsReport>(await regenerate());
    await prisma.trip.update({ where: { id: done.id }, data: { totalPrice: "1300.00" } });
    const second = await json<AnalyticsReport>(await regenerate());
    expect(second.createdAt).toBe(first.createdAt);
    expect(new Date(second.generatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.generatedAt).getTime(),
    );
    expect(await prisma.analyticsDocument.count()).toBe(1);

    const link = await json<AnalyticsReportLink>(
      await agent.request("/v1/staff/analytics/reports/2026/10"),
    );
    const summary = values((await workbookAt(link)).getWorksheet("Summary"));
    expect(summary).toContainEqual(["Revenue (completed trips)", 1300]);

    // Both at once still leave one row.
    await Promise.all([regenerate(), regenerate()]);
    expect(await prisma.analyticsDocument.count()).toBe(1);
  });

  it("only reports on months that are over in Cairo", async () => {
    await expect(
      generateReport({ year: 2026, month: 11 }, new Date("2026-11-30T21:59:00Z")),
    ).rejects.toMatchObject({ code: "REPORT_MONTH_NOT_OVER" });
    // 00:00 on 1 December in Cairo.
    await expect(
      generateReport({ year: 2026, month: 11 }, new Date("2026-11-30T22:00:00Z")),
    ).resolves.toMatchObject({ year: 2026, month: 11 });

    const { agent } = await signedInStaff(["analytics"]);
    const future = await agent.request("/v1/staff/analytics/reports/2999/1/regenerate", {
      method: "POST",
    });
    expect(future.status).toBe(422);
    expect(await json<{ code: string }>(future)).toMatchObject({ code: "REPORT_MONTH_NOT_OVER" });
  });

  it("answers 404 for a month without a report and 400 for a month that isn't one", async () => {
    const { agent } = await signedInStaff(["analytics"]);
    const missing = await agent.request("/v1/staff/analytics/reports/2026/9");
    expect(missing.status).toBe(404);
    for (const path of ["2026/13", "2026/0", "1999/5", "2026/x"]) {
      const response = await agent.request(`/v1/staff/analytics/reports/${path}`);
      expect(response.status, path).toBe(400);
    }
  });

  it("needs `analytics`", async () => {
    const { agent } = await signedInStaff(["trips", "fleet", "pricing", "customers", "team"]);
    expect((await agent.request("/v1/staff/analytics/reports")).status).toBe(403);
    expect((await agent.request("/v1/staff/analytics/reports/2026/10")).status).toBe(403);
    const regenerate = await agent.request("/v1/staff/analytics/reports/2026/10/regenerate", {
      method: "POST",
    });
    expect(regenerate.status).toBe(403);
  });
});

describe("the monthly report job", () => {
  it("is scheduled for 02:00 on the 1st, Cairo time, once however often the worker starts", async () => {
    const now = new Date("2026-11-21T10:00:00Z");
    await scheduleAnalyticsJobs(queues.analytics, now);
    await scheduleAnalyticsJobs(queues.analytics, now);

    const schedulers = await queues.analytics.getJobSchedulers();
    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]).toMatchObject({
      key: MONTHLY_REPORT_JOB,
      name: MONTHLY_REPORT_JOB,
      pattern: monthlyReportSchedule.pattern,
      tz: "Africa/Cairo",
    });
    expect(new Date(Number(schedulers[0]?.next)).toISOString()).toBe("2026-12-01T00:00:00.000Z");

    // The catch-up job for October, added once.
    const catchUp = await queues.analytics.getJob(`${MONTHLY_REPORT_JOB}-2026-10`);
    expect(catchUp?.name).toBe(MONTHLY_REPORT_JOB);
    expect(await queues.analytics.getWaitingCount()).toBe(1);
  });

  it("writes the previous month's report once, skipping a month that has one", async () => {
    await october();
    // 02:00 on 1 November in Cairo.
    const run = new Date("2026-11-01T00:00:00Z");
    const report = await generateDueReport(run);
    expect(report).toMatchObject({ year: 2026, month: 10 });
    expect(await generateDueReport(run)).toBeNull();
    expect(await prisma.analyticsDocument.count()).toBe(1);

    const file = await storage.get("analytics/reports/2026-10.xlsx");
    expect(file?.body.byteLength).toBe(report?.size);
  });

  it("refuses jobs it doesn't know", async () => {
    await expect(processAnalyticsJob({ name: "something-else" } as never)).rejects.toThrow(
      "Unknown analytics job",
    );
  });
});
