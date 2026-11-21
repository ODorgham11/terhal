import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../src/platform/db/prisma";
import { resetDatabase } from "../../support/database";
import { DASHBOARD_ORIGIN, createAgent } from "../../support/http";
import { signedInStaff } from "../../support/fleet";
import { resetRedis } from "../../support/redis";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

// Every fleet and office route, and whether it's a read (fleet or trips) or a write (fleet only, and the ledger).
const routesFor = (ids: { driver: string; vehicle: string; office: string }) =>
  [
    ["GET", "/v1/staff/drivers", "read"],
    ["POST", "/v1/staff/drivers", "write"],
    ["GET", `/v1/staff/drivers/${ids.driver}`, "read"],
    ["PATCH", `/v1/staff/drivers/${ids.driver}`, "write"],
    ["POST", `/v1/staff/drivers/${ids.driver}/archive`, "write"],
    ["POST", `/v1/staff/drivers/${ids.driver}/restore`, "write"],
    ["GET", `/v1/staff/drivers/${ids.driver}/trips`, "read"],
    ["GET", `/v1/staff/drivers/${ids.driver}/transactions`, "write"],
    ["POST", `/v1/staff/drivers/${ids.driver}/transactions`, "write"],
    ["GET", "/v1/staff/vehicles", "read"],
    ["POST", "/v1/staff/vehicles", "write"],
    ["GET", `/v1/staff/vehicles/${ids.vehicle}`, "read"],
    ["PATCH", `/v1/staff/vehicles/${ids.vehicle}`, "write"],
    ["POST", `/v1/staff/vehicles/${ids.vehicle}/archive`, "write"],
    ["POST", `/v1/staff/vehicles/${ids.vehicle}/restore`, "write"],
    ["POST", `/v1/staff/vehicles/${ids.vehicle}/images`, "write"],
    ["DELETE", `/v1/staff/vehicles/${ids.vehicle}/images/any`, "write"],
    ["PUT", `/v1/staff/vehicles/${ids.vehicle}/images/order`, "write"],
    ["GET", "/v1/staff/offices", "read"],
    ["GET", "/v1/staff/offices/nearby?latitude=30&longitude=31", "read"],
    ["POST", "/v1/staff/offices", "write"],
    ["GET", `/v1/staff/offices/${ids.office}`, "read"],
    ["PATCH", `/v1/staff/offices/${ids.office}`, "write"],
    ["POST", `/v1/staff/offices/${ids.office}/archive`, "write"],
    ["POST", `/v1/staff/offices/${ids.office}/restore`, "write"],
  ] as const;

const seed = async () => {
  const driver = await prisma.driver.create({
    data: { firstName: "A", lastName: "B", phone: "+201001111111" },
  });
  const vehicle = await prisma.vehicle.create({
    data: { make: "Kia", model: "Rio", plateNumber: "P 1", color: "Red", body: "SEDAN" },
  });
  const office = await prisma.office.create({
    data: { name: "Office", contact: "C", phone: "+201002222222", address: "A" },
  });
  return { driver: driver.id, vehicle: vehicle.id, office: office.id };
};

describe("fleet permissions", () => {
  it("lets reads in with fleet or trips, and writes with fleet only", async () => {
    const routes = routesFor(await seed());
    const { agent: trips } = await signedInStaff(["trips"]);
    const { agent: other } = await signedInStaff(["pricing", "customers", "team", "analytics"]);
    const anonymous = createAgent(DASHBOARD_ORIGIN);

    for (const [method, path, kind] of routes) {
      const label = `${method} ${path}`;
      const init = { method, ...(method !== "GET" && method !== "DELETE" && { json: {} }) };

      expect((await anonymous.request(path, init)).status, label).toBe(401);
      expect((await other.request(path, init)).status, label).toBe(403);
      const asTrips = (await trips.request(path, init)).status;
      if (kind === "write") expect(asTrips, label).toBe(403);
      else expect(asTrips, label).toBe(200);
    }
  });

  it("lets a fleet member through every route's permission check", async () => {
    const routes = routesFor(await seed());
    const { agent } = await signedInStaff(["fleet"]);
    for (const [method, path] of routes) {
      const init = { method, ...(method !== "GET" && method !== "DELETE" && { json: {} }) };
      const status = (await agent.request(path, init)).status;
      expect([401, 403], `${method} ${path}`).not.toContain(status);
    }
  });
});
