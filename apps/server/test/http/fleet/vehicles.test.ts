import type { Vehicle, VehicleImageUpload } from "@terhal/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { routes } from "../../../src/http/router";
import { prisma } from "../../../src/platform/db/prisma";
import { storage } from "../../../src/platform/storage/index";
import {
  nextSweep,
  sweepVehicleImageUploads,
} from "../../../src/modules/fleet/application/vehicle-images";
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

// The dashboard's three steps: ask for a link, put the file there, confirm it. Answers with the first step that failed,
// or the confirm.
const requestUpload = (agent: Agent, vehicleId: string, json: Record<string, unknown>) =>
  agent.request(`/v1/staff/vehicles/${vehicleId}/images/uploads`, { method: "POST", json });

const putFile = (
  link: VehicleImageUpload,
  bytes: Uint8Array<ArrayBuffer>,
  headers = link.headers,
) => {
  const { pathname, search } = new URL(link.url);
  return routes.request(pathname + search, { method: link.method, headers, body: bytes });
};

const confirm = (agent: Agent, vehicleId: string, uploadId: string) =>
  agent.request(`/v1/staff/vehicles/${vehicleId}/images`, { method: "POST", json: { uploadId } });

const upload = async (
  agent: Agent,
  vehicleId: string,
  bytes: Uint8Array<ArrayBuffer>,
  contentType = "image/png",
) => {
  const requested = await requestUpload(agent, vehicleId, { contentType, size: bytes.byteLength });
  if (requested.status !== 201) return requested;
  const link = await bodyOf<VehicleImageUpload>(requested);
  const put = await putFile(link, bytes);
  if (put.status !== 200) return put;
  return confirm(agent, vehicleId, link.uploadId);
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
      const response = await upload(agent, vehicle.id, bytes);
      expect(response.status).toBe(422);
      expect((await bodyOf(response)).code).toBe("IMAGE_TYPE_NOT_ALLOWED");
    }
    // Nor are they asked for.
    for (const json of [{ contentType: "image/gif", size: 100 }, {}]) {
      expect((await requestUpload(agent, vehicle.id, json)).status).toBe(400);
    }
    expect(await prisma.vehicleImage.count()).toBe(0);
    // A refused file is deleted, its upload with it.
    expect(await prisma.vehicleImageUpload.count()).toBe(0);
  });

  it("refuses an image over 5 MB", async () => {
    const { agent } = await signedInStaff();
    const vehicle = await addVehicle(agent);

    // Refused when asked for...
    const justOver = await upload(agent, vehicle.id, withHeader(PNG, 5 * 1024 * 1024 + 1));
    expect(justOver.status).toBe(400);

    // ...when put, if the file is bigger than it said...
    const link = await bodyOf<VehicleImageUpload>(
      await requestUpload(agent, vehicle.id, { contentType: "image/png", size: 256 }),
    );
    expect((await putFile(link, withHeader(PNG, 6 * 1024 * 1024))).status).toBe(413);

    // ...and when confirmed, whatever reached storage (a bucket doesn't check the size).
    const bucket = await bodyOf<VehicleImageUpload>(
      await requestUpload(agent, vehicle.id, { contentType: "image/png", size: 256 }),
    );
    const { key } = await prisma.vehicleImageUpload.findUniqueOrThrow({
      where: { id: bucket.uploadId },
    });
    await storage.put(key, withHeader(PNG, 5 * 1024 * 1024 + 1), "image/png");
    const confirmed = await confirm(agent, vehicle.id, bucket.uploadId);
    expect(confirmed.status).toBe(413);
    expect((await bodyOf(confirmed)).code).toBe("PAYLOAD_TOO_LARGE");
    expect(await storage.get(key)).toBeNull();

    expect((await upload(agent, vehicle.id, withHeader(PNG, 5 * 1024 * 1024))).status).toBe(201);
  });

  it("puts files only where and as the link was signed for, and confirms only what arrived", async () => {
    const { agent } = await signedInStaff();
    const vehicle = await addVehicle(agent);
    const link = await bodyOf<VehicleImageUpload>(
      await requestUpload(agent, vehicle.id, { contentType: "image/png", size: 256 }),
    );
    expect(link.method).toBe("PUT");
    expect(link.headers).toEqual({ "Content-Type": "image/png" });

    // Another content type, or another key, breaks the signature.
    expect((await putFile(link, withHeader(PNG), { "Content-Type": "image/jpeg" })).status).toBe(
      403,
    );
    const elsewhere = new URL(link.url);
    elsewhere.searchParams.set("key", `vehicles/${vehicle.id}/other`);
    expect((await putFile({ ...link, url: elsewhere.href }, withHeader(PNG))).status).toBe(403);

    // Nothing there yet.
    const early = await confirm(agent, vehicle.id, link.uploadId);
    expect(early.status).toBe(409);
    expect((await bodyOf(early)).code).toBe("UPLOAD_INCOMPLETE");

    expect((await putFile(link, withHeader(PNG))).status).toBe(200);
    // Only whoever asked for it can confirm it, and only for this vehicle.
    const { agent: other } = await signedInStaff(["fleet"], "other@terhal.co");
    expect((await confirm(other, vehicle.id, link.uploadId)).status).toBe(404);
    expect((await confirm(agent, "missing", link.uploadId)).status).toBe(404);

    expect((await confirm(agent, vehicle.id, link.uploadId)).status).toBe(201);
    // Once.
    expect((await confirm(agent, vehicle.id, link.uploadId)).status).toBe(404);
    expect(await prisma.vehicleImage.count({ where: { vehicleId: vehicle.id } })).toBe(1);
  });

  it("sweeps uploads never confirmed, with their files, once their link is long gone", async () => {
    const { agent } = await signedInStaff();
    const vehicle = await addVehicle(agent);
    const link = await bodyOf<VehicleImageUpload>(
      await requestUpload(agent, vehicle.id, { contentType: "image/png", size: 256 }),
    );
    await putFile(link, withHeader(PNG));
    const { key, expiresAt } = await prisma.vehicleImageUpload.findUniqueOrThrow({
      where: { id: link.uploadId },
    });

    expect(await sweepVehicleImageUploads(new Date(expiresAt.getTime() + 30 * 60_000))).toBe(0);
    expect(await nextSweep()).toEqual(new Date(expiresAt.getTime() + 60 * 60_000));

    expect(await sweepVehicleImageUploads(new Date(expiresAt.getTime() + 61 * 60_000))).toBe(1);
    expect(await prisma.vehicleImageUpload.count()).toBe(0);
    expect(await storage.get(key)).toBeNull();
    expect(await nextSweep()).toBeNull();
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
