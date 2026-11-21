import { randomUUID } from "node:crypto";
import {
  VEHICLE_IMAGE_LIMIT,
  VEHICLE_IMAGE_MAX_BYTES,
  auditActions,
  type ReorderVehicleImages,
} from "@terhal/contracts";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { validationFailed } from "../../../platform/errors/validation";
import { logger } from "../../../platform/logger/logger";
import { storage } from "../../../platform/storage/index";
import { recordAudit } from "../../audit/index";
import { sniffImageType } from "../domain/images";
import { lockRow, notFound, type StaffActor } from "./shared";
import { getVehicle } from "./vehicles";

// A vehicle's photos: JPEG, PNG or WebP, up to 5 MB each and 5 per vehicle, in order with the first as the cover. The
// files live in storage (R2, or a local folder in development); the database holds their keys and positions.

const ENTITY = "Vehicle";

const limitReached = () =>
  new AppError({
    code: "IMAGE_LIMIT_REACHED",
    status: 409,
    detail: `A vehicle can have ${VEHICLE_IMAGE_LIMIT} images at most. Delete one first.`,
  });

// Deleting a stored file is cleanup: if it fails, the file is orphaned (nothing points at it), never the other way round.
const discard = (key: string) =>
  storage.delete(key).catch((error: unknown) => {
    logger.warn({ err: error, key }, "couldn't delete a stored file");
  });

// Adds the image after the vehicle's others. The file is stored first and the row written after, under a lock on the
// vehicle, so two uploads at once can't both take the last place; if the row can't be written, the file is deleted.
export const addVehicleImage = async (vehicleId: string, bytes: Uint8Array, actor: StaffActor) => {
  if (bytes.byteLength > VEHICLE_IMAGE_MAX_BYTES) {
    throw new AppError({
      code: "PAYLOAD_TOO_LARGE",
      status: 413,
      detail: "An image can be 5 MB at most.",
    });
  }
  const contentType = sniffImageType(bytes);
  if (!contentType) {
    throw new AppError({
      code: "IMAGE_TYPE_NOT_ALLOWED",
      status: 422,
      detail: "Upload a JPEG, PNG or WebP image.",
    });
  }

  // Checked before uploading too, so a vehicle that's full doesn't cost an upload.
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { _count: { select: { images: true } } },
  });
  if (!vehicle) throw notFound("vehicle");
  if (vehicle._count.images >= VEHICLE_IMAGE_LIMIT) throw limitReached();

  const key = `vehicles/${vehicleId}/${randomUUID()}`;
  await storage.put(key, bytes, contentType);

  try {
    await prisma.$transaction(async (tx) => {
      if (!(await lockRow(tx, "Vehicle", vehicleId))) throw notFound("vehicle");
      const position = await tx.vehicleImage.count({ where: { vehicleId } });
      if (position >= VEHICLE_IMAGE_LIMIT) throw limitReached();

      const image = await tx.vehicleImage.create({
        data: { vehicleId, bucket: storage.bucket, key, position },
        select: { id: true },
      });
      await recordAudit(
        {
          staffId: actor.staffId,
          ipAddress: actor.ipAddress,
          action: auditActions.VEHICLE_IMAGE_ADDED,
          entityType: ENTITY,
          entityId: vehicleId,
          after: { imageId: image.id, position, contentType, bytes: bytes.byteLength },
        },
        tx,
      );
    });
  } catch (error) {
    await discard(key);
    throw error;
  }

  return getVehicle(vehicleId);
};

// The images after it move up one place, so the order stays 0, 1, 2... and the next one becomes the cover if the cover
// was deleted.
export const deleteVehicleImage = async (vehicleId: string, imageId: string, actor: StaffActor) => {
  const key = await prisma.$transaction(async (tx) => {
    if (!(await lockRow(tx, "Vehicle", vehicleId))) throw notFound("vehicle");
    const image = await tx.vehicleImage.findFirst({ where: { id: imageId, vehicleId } });
    if (!image) throw notFound("image");

    await tx.vehicleImage.delete({ where: { id: imageId } });
    await tx.vehicleImage.updateMany({
      where: { vehicleId, position: { gt: image.position } },
      data: { position: { decrement: 1 } },
    });
    await recordAudit(
      {
        staffId: actor.staffId,
        ipAddress: actor.ipAddress,
        action: auditActions.VEHICLE_IMAGE_DELETED,
        entityType: ENTITY,
        entityId: vehicleId,
        before: { imageId, position: image.position },
      },
      tx,
    );
    return image.key;
  });

  // After the commit: a rollback must never leave a row pointing at a deleted file.
  await discard(key);
  return getVehicle(vehicleId);
};

// The request lists every image of the vehicle once, in the new order.
export const reorderVehicleImages = async (
  vehicleId: string,
  { imageIds }: ReorderVehicleImages,
  actor: StaffActor,
) => {
  await prisma.$transaction(async (tx) => {
    if (!(await lockRow(tx, "Vehicle", vehicleId))) throw notFound("vehicle");
    const images = await tx.vehicleImage.findMany({
      where: { vehicleId },
      orderBy: { position: "asc" },
      select: { id: true },
    });

    const current = images.map((image) => image.id);
    const known = new Set(current);
    if (imageIds.length !== current.length || !imageIds.every((id) => known.has(id))) {
      throw validationFailed([
        {
          in: "json",
          path: "imageIds",
          code: "custom",
          message: "List every image of the vehicle, each once.",
        },
      ]);
    }

    // One connection runs a transaction's queries one at a time anyway.
    for (const [position, id] of imageIds.entries()) {
      await tx.vehicleImage.update({ where: { id }, data: { position } });
    }
    await recordAudit(
      {
        staffId: actor.staffId,
        ipAddress: actor.ipAddress,
        action: auditActions.VEHICLE_IMAGES_REORDERED,
        entityType: ENTITY,
        entityId: vehicleId,
        before: { imageIds: current },
        after: { imageIds },
      },
      tx,
    );
  });
  return getVehicle(vehicleId);
};
