import type { NearbyOffices, Office, OfficeDetail } from "@terhal/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../src/platform/db/prisma";
import { resetDatabase } from "../../support/database";
import {
  bodyOf,
  createTrip,
  governorate,
  place,
  signedInStaff,
  type Agent,
  type Page,
} from "../../support/fleet";
import { resetRedis } from "../../support/redis";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

const officeInput = (overrides: Record<string, unknown> = {}) => ({
  name: "Cairo Rentals",
  contact: "Ali",
  phone: "01009999999",
  email: "Desk@Rentals.example",
  address: "12 Road 9, Maadi",
  ...overrides,
});

const addOffice = async (agent: Agent, overrides: Record<string, unknown> = {}) => {
  const response = await agent.request("/v1/staff/offices", {
    method: "POST",
    json: officeInput(overrides),
  });
  expect(response.status).toBe(201);
  return bodyOf<Office>(response);
};

describe("creating and changing offices", () => {
  it("adds an office at a live location, audited", async () => {
    const { agent, staff } = await signedInStaff();
    const cairo = await governorate("Cairo");
    const office = await addOffice(agent, { locationId: cairo.id });
    expect(office).toMatchObject({
      name: "Cairo Rentals",
      phone: "+201009999999",
      email: "desk@rentals.example",
      location: { id: cairo.id, nameEn: "Cairo", locality: "GOVERNORATE" },
      archivedAt: null,
    });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: office.id } });
    expect(log).toMatchObject({ action: "fleet.office.created", staffId: staff.id });
  });

  it("refuses a deleted or unknown location, and a taken name", async () => {
    const { agent } = await signedInStaff();
    const gone = await governorate("Gone");
    await prisma.location.update({
      where: { id: gone.id },
      data: { deletedAt: new Date(), deletedWithId: gone.id },
    });
    for (const locationId of [gone.id, "missing"]) {
      const response = await agent.request("/v1/staff/offices", {
        method: "POST",
        json: officeInput({ locationId }),
      });
      expect(response.status).toBe(422);
      expect((await bodyOf(response)).code).toBe("LOCATION_NOT_AVAILABLE");
    }

    await addOffice(agent);
    const duplicate = await agent.request("/v1/staff/offices", {
      method: "POST",
      json: officeInput({ phone: "01008888888" }),
    });
    expect(duplicate.status).toBe(409);
    expect((await bodyOf(duplicate)).code).toBe("OFFICE_NAME_TAKEN");
  });

  it("changes only the fields sent", async () => {
    const { agent } = await signedInStaff();
    const office = await addOffice(agent);
    const response = await agent.request(`/v1/staff/offices/${office.id}`, {
      method: "PATCH",
      json: { contact: "Mona", email: null },
    });
    expect(response.status).toBe(200);
    expect(await bodyOf<Office>(response)).toMatchObject({
      name: "Cairo Rentals",
      contact: "Mona",
      email: null,
    });
    expect(
      (await agent.request("/v1/staff/offices/missing", { method: "PATCH", json: {} })).status,
    ).toBe(404);
  });

  it("lists by search and archive state", async () => {
    const { agent } = await signedInStaff();
    await addOffice(agent);
    await addOffice(agent, { name: "Giza Cars", contact: "Omar" });
    const names = async (query: string) =>
      (await bodyOf<Page<Office>>(await agent.request(`/v1/staff/offices${query}`))).data.map(
        (office: { name: string }) => office.name,
      );
    expect(await names("")).toEqual(["Cairo Rentals", "Giza Cars"]);
    expect(await names("?q=omar")).toEqual(["Giza Cars"]);
    expect(await names("?archived=true")).toEqual([]);
  });
});

describe("an office's detail", () => {
  it("returns its live drivers, vehicles and live trips", async () => {
    const { agent } = await signedInStaff();
    const office = await addOffice(agent);
    const driver = await prisma.driver.create({
      data: {
        firstName: "Sami",
        lastName: "Fouad",
        phone: "+201001111111",
        isExternal: true,
        officeId: office.id,
      },
    });
    await prisma.driver.create({
      data: {
        firstName: "Old",
        lastName: "Driver",
        phone: "+201002222222",
        isExternal: true,
        officeId: office.id,
        archivedAt: new Date(),
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        make: "Kia",
        model: "Carens",
        plateNumber: "OFF 1",
        color: "Grey",
        body: "MINIVAN",
        isExternal: true,
        officeId: office.id,
      },
    });
    const live = await createTrip({ officeId: office.id, driverId: driver.id, status: "PENDING" });
    await createTrip({ officeId: office.id, status: "COMPLETED" });

    const response = await agent.request(`/v1/staff/offices/${office.id}`);
    expect(response.status).toBe(200);
    const detail = await bodyOf<OfficeDetail>(response);
    expect(detail.drivers.map((d: { id: string }) => d.id)).toEqual([driver.id]);
    expect(detail.vehicles.map((v: { id: string }) => v.id)).toEqual([vehicle.id]);
    expect(detail.trips.map((t: { id: string }) => t.id)).toEqual([live.id]);
    expect(detail.trips[0]?.office).toEqual({
      id: office.id,
      name: "Cairo Rentals",
      archived: false,
    });

    expect((await agent.request("/v1/staff/offices/missing")).status).toBe(404);
  });
});

describe("archiving offices", () => {
  it("is blocked while trips handed to it are live", async () => {
    const { agent } = await signedInStaff();
    const office = await addOffice(agent);
    const trip = await createTrip({ officeId: office.id, status: "CONFIRMED" });

    const blocked = await agent.request(`/v1/staff/offices/${office.id}/archive`, {
      method: "POST",
    });
    expect(blocked.status).toBe(409);
    expect((await bodyOf(blocked)).code).toBe("HAS_UPCOMING_TRIPS");

    await prisma.trip.update({ where: { id: trip.id }, data: { status: "CANCELLED" } });
    const archived = await agent.request(`/v1/staff/offices/${office.id}/archive`, {
      method: "POST",
    });
    expect(archived.status).toBe(200);
    expect((await bodyOf<Office>(archived)).archivedAt).not.toBeNull();

    // An archived office takes no new drivers or vehicles.
    const driver = await agent.request("/v1/staff/drivers", {
      method: "POST",
      json: {
        firstName: "Sami",
        lastName: "Fouad",
        phone: "01001111111",
        licenseNumber: "L",
        licenseExpiresAt: "2030-01-01",
        isExternal: true,
        officeId: office.id,
      },
    });
    expect((await bodyOf(driver)).code).toBe("OFFICE_NOT_AVAILABLE");

    const restored = await agent.request(`/v1/staff/offices/${office.id}/restore`, {
      method: "POST",
    });
    expect((await bodyOf<Office>(restored)).archivedAt).toBeNull();
  });
});

describe("offices near a pickup", () => {
  // Cairo (an outline) holds Maadi (a district) with Degla (an area) inside it, and Nasr City (another district). Giza
  // is another governorate.
  const setUp = async (agent: Agent) => {
    const cairo = await governorate("Cairo");
    await prisma.$executeRaw`
      UPDATE "Location" SET "boundary" = polygon '((31.1,29.9),(31.5,29.9),(31.5,30.2),(31.1,30.2))'
      WHERE "id" = ${cairo.id}`;
    const maadi = await place(cairo.id, "DISTRICT", "Maadi", 29.96, 31.25, 5_000);
    const degla = await place(maadi.id, "AREA", "Degla", 29.96, 31.27, 2_000);
    const nasr = await place(cairo.id, "DISTRICT", "Nasr City", 30.06, 31.33, 5_000);
    const giza = await governorate("Giza");

    const at = async (name: string, locationId: string) =>
      (await addOffice(agent, { name, locationId })).id;
    const offices = {
      degla: await at("Degla Office", degla.id),
      maadi: await at("Maadi Office", maadi.id),
      cairo: await at("Cairo Office", cairo.id),
      nasr: await at("Nasr Office", nasr.id),
      giza: await at("Giza Office", giza.id),
      archived: await at("Archived Maadi Office", maadi.id),
    };
    await agent.request(`/v1/staff/offices/${offices.archived}/archive`, { method: "POST" });
    return { offices, degla, maadi, cairo };
  };

  const nearby = async (agent: Agent, latitude: number, longitude: number) => {
    const response = await agent.request(
      `/v1/staff/offices/nearby?latitude=${latitude}&longitude=${longitude}`,
    );
    expect(response.status).toBe(200);
    return bodyOf<NearbyOffices>(response);
  };

  it("resolves the pin to the most specific place and lists its ancestors' offices, nearest first", async () => {
    const { agent } = await signedInStaff(["trips"]);
    const { agent: fleet } = await signedInStaff(["fleet"]);
    const { offices, degla } = await setUp(fleet);

    const result = await nearby(agent, 29.961, 31.271);
    expect(result.location).toMatchObject({ id: degla.id, locality: "AREA" });
    expect(result.data.map((office: { id: string }) => office.id)).toEqual([
      offices.degla,
      offices.maadi,
      offices.cairo,
    ]);
    expect(result.data[0]?.distanceMeters).toBeLessThan(200);
    expect(result.data[2]?.distanceMeters).toBeNull();
  });

  it("includes offices in the places inside the pin's place", async () => {
    const { agent } = await signedInStaff();
    const { offices, maadi, cairo } = await setUp(agent);

    // In Maadi, outside Degla's circle: Maadi's center is nearer than Degla's.
    const inMaadi = await nearby(agent, 29.96, 31.22);
    expect(inMaadi.location?.id).toBe(maadi.id);
    expect(inMaadi.data.map((office: { id: string }) => office.id)).toEqual([
      offices.maadi,
      offices.degla,
      offices.cairo,
    ]);

    // Inside Cairo's outline but no circle: every office in Cairo, the governorate's own last.
    const inCairo = await nearby(agent, 30.15, 31.15);
    expect(inCairo.location?.id).toBe(cairo.id);
    expect(inCairo.data.map((office: { id: string }) => office.id)).toEqual([
      offices.nasr,
      offices.maadi,
      offices.degla,
      offices.cairo,
    ]);
  });

  it("finds nothing outside coverage, and checks the pin", async () => {
    const { agent } = await signedInStaff();
    await setUp(agent);
    expect(await nearby(agent, 25, 30)).toEqual({ location: null, data: [] });
    expect((await agent.request("/v1/staff/offices/nearby?latitude=95&longitude=31")).status).toBe(
      400,
    );
    expect((await agent.request("/v1/staff/offices/nearby?latitude=30")).status).toBe(400);
  });
});
