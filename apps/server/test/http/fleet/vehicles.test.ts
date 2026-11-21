import type { Vehicle } from "@terhal/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { routes } from "../../../src/http/router";
import { prisma } from "../../../src/platform/db/prisma";
import { storage } from "../../../src/platform/storage/index";
import { resetDatabase } from "../../support/database";
import { bodyOf, createTrip, signedInStaff, type Agent, type Page } from "../../support/fleet";
import { resetRedis } from "../../support/redis";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

const vehicleInput = (overrides: Record<string, unknown> = {}) => ({
  make: "Toyota",
  model: "Corolla",
  year: 2022,
  plateNumber: "abc  1234",
  color: "White",
  body: "SEDAN",
  ...overrides,
});

const addVehicle = async (agent: Agent, overrides: Record<string, unknown> = {}) => {
  const response = await agent.request("/v1/staff/vehicles", {
    method: "POST",
    json: vehicleInput(overrides),
  });
  expect(response.status).toBe(201);
  return bodyOf<Vehicle>(response);
};

// Files that only need to start like the real thing: the type is judged from the first bytes.
const withHeader = (header: number[], size = 256) => {
  const bytes = new Uint8Array(size);
  bytes.set(header);
  return bytes;
};
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

const upload = (
  agent: Agent,
  vehicleId: string,
  bytes: Uint8Array<ArrayBuffer>,
  name = "photo.png",
) => {
  const form = new FormData();
  form.append("file", new File([bytes], name, { type: "image/png" }));
  return agent.request(`/v1/staff/vehicles/${vehicleId}/images`, { method: "POST", body: form });
};

const fetchSigned = (url: string) => {
  const { pathname, search } = new URL(url);
  return routes.request(pathname + search);
};

describe("creating and changing vehicles", () => {
  it("adds a vehicle with a required body and a normalized plate, audited", async () => {
    const { agent, staff } = await signedInStaff();
    const vehicle = await addVehicle(agent);
    expect(vehicle).toMatchObject({
      make: "Toyota",
      plateNumber: "ABC 1234",
      body: "SEDAN",
      isExternal: false,
      office: null,
      images: [],
      archivedAt: null,
    });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: vehicle.id } });
    expect(log).toMatchObject({ action: "fleet.vehicle.created", staffId: staff.id });

    const missingBody = await agent.request("/v1/staff/vehicles", {
      method: "POST",
      json: vehicleInput({ body: undefined, plateNumber: "XYZ 1" }),
    });
    expect(missingBody.status).toBe(400);
  });

  it("refuses a plate another vehicle has", async () => {
    const { agent } = await signedInStaff();
    await addVehicle(agent);
    const response = await agent.request("/v1/staff/vehicles", {
      method: "POST",
      json: vehicleInput({ plateNumber: "ABC 1234" }),
    });
    expect(response.status).toBe(409);
    expect((await bodyOf(response)).code).toBe("PLATE_NUMBER_TAKEN");
  });

  it("links only external vehicles to an office (the database check)", async () => {
    const { agent } = await signedInStaff();
    const office = await prisma.office.create({
      data: { name: "Rentals", contact: "Ali", phone: "+201000000009", address: "Cairo" },
    });
    const internal = await agent.request("/v1/staff/vehicles", {
      method: "POST",
      json: vehicleInput({ officeId: office.id }),
    });
    expect(internal.status).toBe(422);
    expect((await bodyOf(internal)).code).toBe("OFFICE_REQUIRES_EXTERNAL");

    const vehicle = await addVehicle(agent, { isExternal: true, officeId: office.id });
    const update = await agent.request(`/v1/staff/vehicles/${vehicle.id}`, {
      method: "PATCH",
      json: { isExternal: false },
    });
    expect((await bodyOf(update)).code).toBe("OFFICE_REQUIRES_EXTERNAL");

    const unlinked = await agent.request(`/v1/staff/vehicles/${vehicle.id}`, {
      method: "PATCH",
      json: { isExternal: false, officeId: null },
    });
    expect(unlinked.status).toBe(200);
    expect(await bodyOf<Vehicle>(unlinked)).toMatchObject({ isExternal: false, office: null });
  });

  it("lists by body, search and archive state", async () => {
    const { agent } = await signedInStaff();
    await addVehicle(agent);
    await addVehicle(agent, { make: "Hyundai", model: "H1", plateNumber: "VAN 1", body: "VAN" });
    const old = await addVehicle(agent, { make: "Kia", plateNumber: "OLD 1" });
    await agent.request(`/v1/staff/vehicles/${old.id}/archive`, { method: "POST" });

    const makes = async (query: string) =>
      (await bodyOf<Page<Vehicle>>(await agent.request(`/v1/staff/vehicles${query}`))).data.map(
        (vehicle: { make: string }) => vehicle.make,
      );
    expect(await makes("")).toEqual(["Hyundai", "Toyota"]);
    expect(await makes("?body=VAN")).toEqual(["Hyundai"]);
    expect(await makes("?q=abc%201234")).toEqual(["Toyota"]);
    expect(await makes("?archived=true")).toEqual(["Kia"]);
    expect((await agent.request("/v1/staff/vehicles?body=BUS")).status).toBe(400);
  });

  it("answers 404 for an unknown vehicle", async () => {
    const { agent } = await signedInStaff();
    expect((await agent.request("/v1/staff/vehicles/missing")).status).toBe(404);
    expect(
      (await agent.request("/v1/staff/vehicles/missing/archive", { method: "POST" })).status,
    ).toBe(404);
    expect((await upload(agent, "missing", withHeader(PNG))).status).toBe(404);
  });
});

describe("archiving vehicles", () => {
  it("is blocked while the vehicle is on a live trip", async () => {
    const { agent } = await signedInStaff();
    const vehicle = await addVehicle(agent);
    const trip = await createTrip({ vehicleId: vehicle.id, status: "IN_PROGRESS" });

    const blocked = await agent.request(`/v1/staff/vehicles/${vehicle.id}/archive`, {
      method: "POST",
    });
    expect(blocked.status).toBe(409);
    expect((await bodyOf(blocked)).code).toBe("HAS_UPCOMING_TRIPS");

    await prisma.trip.update({ where: { id: trip.id }, data: { status: "AWAITING_REPORT" } });
    const archived = await agent.request(`/v1/staff/vehicles/${vehicle.id}/archive`, {
      method: "POST",
    });
    expect(archived.status).toBe(200);

    const restored = await agent.request(`/v1/staff/vehicles/${vehicle.id}/restore`, {
      method: "POST",
    });
    expect((await bodyOf<Vehicle>(restored)).archivedAt).toBeNull();
  });
});

describe("vehicle images", () => {
  it("stores JPEG, PNG and WebP in order, with signed links", async () => {
    const { agent } = await signedInStaff();
    const vehicle = await addVehicle(agent);

    for (const header of [PNG, JPEG, WEBP]) {
      const response = await upload(agent, vehicle.id, withHeader(header));
      expect(response.status).toBe(201);
    }
    const { images } = await bodyOf<Vehicle>(
      await agent.request(`/v1/staff/vehicles/${vehicle.id}`),
    );
    expect(images.map((image: { position: number }) => image.position)).toEqual([0, 1, 2]);

    // The type stored is the one sniffed from the bytes, whatever the browser claimed.
    const types = [];
    for (const image of images as { url: string }[]) {
      const response = await fetchSigned(image.url);
      expect(response.status).toBe(200);
      types.push(response.headers.get("content-type"));
    }
    expect(types).toEqual(["image/png", "image/jpeg", "image/webp"]);

    const rows = await prisma.vehicleImage.findMany({ where: { vehicleId: vehicle.id } });
    expect(rows.every((row) => row.bucket === "local")).toBe(true);
    expect(
      await prisma.auditLog.count({
        where: { entityId: vehicle.id, action: "fleet.vehicle.image_added" },
      }),
    ).toBe(3);
  });

  it("refuses other types, judged from the bytes", async () => {
    const { agent } = await signedInStaff();
    const vehicle = await addVehicle(agent);
    for (const bytes of [withHeader(GIF), new TextEncoder().encode("<svg></svg>")]) {
      const response = await upload(agent, vehicle.id, bytes, "photo.png");
      expect(response.status).toBe(422);
      expect((await bodyOf(response)).code).toBe("IMAGE_TYPE_NOT_ALLOWED");
    }
    const missing = await agent.request(`/v1/staff/vehicles/${vehicle.id}/images`, {
      method: "POST",
      body: new FormData(),
    });
    expect(missing.status).toBe(400);
    expect(await prisma.vehicleImage.count()).toBe(0);
  });

  it("refuses an image over 5 MB", async () => {
    const { agent } = await signedInStaff();
    const vehicle = await addVehicle(agent);

    const justOver = await upload(agent, vehicle.id, withHeader(PNG, 5 * 1024 * 1024 + 1));
    expect(justOver.status).toBe(413);
    expect((await bodyOf(justOver)).code).toBe("PAYLOAD_TOO_LARGE");

    const wayOver = await upload(agent, vehicle.id, withHeader(PNG, 6 * 1024 * 1024));
    expect(wayOver.status).toBe(413);
    expect((await bodyOf(wayOver)).code).toBe("PAYLOAD_TOO_LARGE");

    expect((await upload(agent, vehicle.id, withHeader(PNG, 5 * 1024 * 1024))).status).toBe(201);
  });

  it("keeps at most 5 per vehicle", async () => {
    const { agent } = await signedInStaff();
    const vehicle = await addVehicle(agent);
    for (let i = 0; i < 5; i++) {
      expect((await upload(agent, vehicle.id, withHeader(PNG))).status).toBe(201);
    }
    const sixth = await upload(agent, vehicle.id, withHeader(PNG));
    expect(sixth.status).toBe(409);
    expect((await bodyOf(sixth)).code).toBe("IMAGE_LIMIT_REACHED");
    expect(await prisma.vehicleImage.count({ where: { vehicleId: vehicle.id } })).toBe(5);
  });

  it("keeps 5 even when uploads race for the last place", async () => {
    const { agent } = await signedInStaff();
    const vehicle = await addVehicle(agent);
    for (let i = 0; i < 4; i++) await upload(agent, vehicle.id, withHeader(PNG));

    const statuses = await Promise.all(
      [0, 1, 2].map(async () => (await upload(agent, vehicle.id, withHeader(PNG))).status),
    );
    expect(statuses.sort()).toEqual([201, 409, 409]);
    const positions = await prisma.vehicleImage.findMany({
      where: { vehicleId: vehicle.id },
      orderBy: { position: "asc" },
      select: { position: true },
    });
    expect(positions.map((row) => row.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it("deletes an image, closes the gap and removes the file", async () => {
    const { agent } = await signedInStaff();
    const vehicle = await addVehicle(agent);
    for (let i = 0; i < 3; i++) await upload(agent, vehicle.id, withHeader(PNG));
    const before = await prisma.vehicleImage.findMany({
      where: { vehicleId: vehicle.id },
      orderBy: { position: "asc" },
    });
    const cover = before[0];
    if (!cover) throw new Error("No cover.");

    const response = await agent.request(`/v1/staff/vehicles/${vehicle.id}/images/${cover.id}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(200);
    const { images } = await bodyOf<Vehicle>(response);
    expect(images.map((image: { id: string }) => image.id)).toEqual(
      before.slice(1).map((image) => image.id),
    );
    expect(images.map((image: { position: number }) => image.position)).toEqual([0, 1]);
    expect(await storage.get(cover.key)).toBeNull();

    const again = await agent.request(`/v1/staff/vehicles/${vehicle.id}/images/${cover.id}`, {
      method: "DELETE",
    });
    expect(again.status).toBe(404);
  });

  it("reorders, the first becoming the cover", async () => {
    const { agent } = await signedInStaff();
    const vehicle = await addVehicle(agent);
    for (let i = 0; i < 3; i++) await upload(agent, vehicle.id, withHeader(PNG));
    const ids = (
      await prisma.vehicleImage.findMany({
        where: { vehicleId: vehicle.id },
        orderBy: { position: "asc" },
      })
    ).map((image) => image.id);
    const reversed = [...ids].reverse();

    const response = await agent.request(`/v1/staff/vehicles/${vehicle.id}/images/order`, {
      method: "PUT",
      json: { imageIds: reversed },
    });
    expect(response.status).toBe(200);
    const { images } = await bodyOf<Vehicle>(response);
    expect(images.map((image: { id: string }) => image.id)).toEqual(reversed);

    // Every image, each once, and only this vehicle's.
    for (const imageIds of [
      reversed.slice(1),
      [...reversed.slice(1), "other"],
      [ids[0], ids[0], ids[1]],
    ]) {
      const bad = await agent.request(`/v1/staff/vehicles/${vehicle.id}/images/order`, {
        method: "PUT",
        json: { imageIds },
      });
      expect(bad.status).toBe(400);
    }
  });
});
