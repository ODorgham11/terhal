import { randomUUID } from "node:crypto";
import {
  VEHICLE_IMAGE_LIMIT,
  VEHICLE_IMAGE_MAX_BYTES,
  auditActions,
  type ConfirmVehicleImageUpload,
  type ReorderVehicleImages,
  type RequestVehicleImageUpload,
} from "@terhal/contracts";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { validationFailed } from "../../../platform/errors/validation";
import { markChanged } from "../../../platform/jobs/gate";
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

// Uploads go straight from the browser to storage, never through the API (docs/architecture.md, Files):
//   1. requestVehicleImageUpload: the dashboard says what it's about to upload; the API checks the vehicle has room and
//      answers with a link signed for one new key and that content type, good for UPLOAD_LIFETIME.
//   2. The browser PUTs the file to the link.
//   3. confirmVehicleImageUpload: the API reads what arrived, checks its size and its type from the bytes, and only then
//      makes it the vehicle's next image, under a lock on the vehicle so two confirms can't both take the last place.
// Anything that fails a check is deleted. Uploads never confirmed are swept with their files (sweepVehicleImageUploads).

export const UPLOAD_LIFETIME = 10 * 60;
// How long after its link expires an unconfirmed upload is kept: an upload started just before the expiry may still be
// arriving, and confirming it should still work.
const SWEEP_AFTER = 60 * 60_000;
// What sweep-uploads watches (platform/jobs/gate.ts), so it only wakes the database when there may be something to sweep.
export const UPLOADS_SIGNAL = "fleet.uploads";

export const requestVehicleImageUpload = async (
  vehicleId: string,
  { contentType, size }: RequestVehicleImageUpload,
  actor: StaffActor,
) => {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { _count: { select: { images: true } } },
  });
  if (!vehicle) throw notFound("vehicle");
  if (vehicle._count.images >= VEHICLE_IMAGE_LIMIT) throw limitReached();

  const key = `vehicles/${vehicleId}/${randomUUID()}`;
  const link = await storage.signedUpload(key, contentType, UPLOAD_LIFETIME);
  await markChanged(UPLOADS_SIGNAL);
  const upload = await prisma.vehicleImageUpload.create({
    data: {
      vehicleId,
      staffId: actor.staffId,
      bucket: storage.bucket,
      key,
      contentType,
      size,
      expiresAt: new Date(Date.now() + UPLOAD_LIFETIME * 1000),
    },
    select: { id: true, expiresAt: true },
  });
  return {
    uploadId: upload.id,
    url: link.url,
    method: "PUT" as const,
    headers: link.headers,
    expiresAt: upload.expiresAt.toISOString(),
  };
};

const uploadNotFound = () =>
  new AppError({
    code: "NOT_FOUND",
    status: 404,
    detail: "There's no such upload for this vehicle. Ask for a new one.",
  });

// Forgets an upload that failed a check, file and all.
const reject = async (upload: { id: string; key: string }, error: AppError) => {
  await prisma.vehicleImageUpload.deleteMany({ where: { id: upload.id } });
  await discard(upload.key);
  return error;
};

export const confirmVehicleImageUpload = async (
  vehicleId: string,
  { uploadId }: ConfirmVehicleImageUpload,
  actor: StaffActor,
) => {
  const upload = await prisma.vehicleImageUpload.findFirst({
    where: { id: uploadId, vehicleId, staffId: actor.staffId },
  });
  if (!upload) throw uploadNotFound();

  // Checked before reading it, so a file that's far too big is never downloaded.
  const stored = await storage.stat(upload.key);
  if (!stored) {
    throw new AppError({
      code: "UPLOAD_INCOMPLETE",
      status: 409,
      detail: "The file hasn't reached storage. Upload it to the link, then confirm again.",
    });
  }
  if (stored.size > VEHICLE_IMAGE_MAX_BYTES) {
    throw await reject(
      upload,
      new AppError({
        code: "PAYLOAD_TOO_LARGE",
        status: 413,
        detail: "An image can be 5 MB at most.",
      }),
    );
  }
  const file = await storage.get(upload.key);
  const contentType = file && sniffImageType(file.body);
  if (!file || !contentType) {
    throw await reject(
      upload,
      new AppError({
        code: "IMAGE_TYPE_NOT_ALLOWED",
        status: 422,
        detail: "Upload a JPEG, PNG or WebP image.",
      }),
    );
  }
  // Served with the type its bytes are, whatever was claimed when it was put.
  if (contentType !== file.contentType) await storage.put(upload.key, file.body, contentType);

  try {
    await prisma.$transaction(async (tx) => {
      if (!(await lockRow(tx, "Vehicle", vehicleId))) throw notFound("vehicle");
      // Deleted inside the lock, so the same upload confirmed twice at once makes one image.
      const claimed = await tx.vehicleImageUpload.deleteMany({ where: { id: upload.id } });
      if (claimed.count === 0) throw uploadNotFound();
      const position = await tx.vehicleImage.count({ where: { vehicleId } });
      if (position >= VEHICLE_IMAGE_LIMIT) throw limitReached();

      const image = await tx.vehicleImage.create({
        data: { vehicleId, bucket: upload.bucket, key: upload.key, position },
        select: { id: true },
      });
      await recordAudit(
        {
          staffId: actor.staffId,
          ipAddress: actor.ipAddress,
          action: auditActions.VEHICLE_IMAGE_ADDED,
          entityType: ENTITY,
          entityId: vehicleId,
          after: { imageId: image.id, position, contentType, bytes: file.body.byteLength },
        },
        tx,
      );
    });
  } catch (error) {
    // A full vehicle: nothing points at the file, and the upload is no use any more.
    if (error instanceof AppError && error.code === "IMAGE_LIMIT_REACHED") {
      throw await reject(upload, error);
    }
    throw error;
  }

  return getVehicle(vehicleId);
};

// Uploads never confirmed, an hour after their link stopped working: their files and their rows. Idempotent, so a retry
// or two runs at once only delete what's still there.
export const sweepVehicleImageUploads = async (now = new Date()) => {
  const stale = await prisma.vehicleImageUpload.findMany({
    where: { expiresAt: { lt: new Date(now.getTime() - SWEEP_AFTER) } },
    select: { id: true, key: true },
    take: 500,
  });
  for (const upload of stale) {
    await discard(upload.key);
    await prisma.vehicleImageUpload.deleteMany({ where: { id: upload.id } });
  }
  if (stale.length > 0) logger.info({ job: "sweep-uploads", swept: stale.length }, "swept uploads");
  return stale.length;
};

// When the oldest upload left becomes sweepable; null when there are none, so only a new upload wakes the job.
export const nextSweep = async () => {
  const oldest = await prisma.vehicleImageUpload.findFirst({
    orderBy: { expiresAt: "asc" },
    select: { expiresAt: true },
  });
  return oldest ? new Date(oldest.expiresAt.getTime() + SWEEP_AFTER) : null;
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
