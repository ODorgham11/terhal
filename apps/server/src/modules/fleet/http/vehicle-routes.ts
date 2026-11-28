import { createRoute } from "@hono/zod-openapi";
import {
  ConfirmVehicleImageUpload,
  CreateVehicle,
  IdParam,
  ListVehicles,
  ReorderVehicleImages,
  RequestVehicleImageUpload,
  UpdateVehicle,
  Vehicle,
  VehicleImageUpload,
  page,
} from "@terhal/contracts";
import { z } from "zod";
import { body, createRouter, json, problemResponse } from "../../../platform/http/router";
import { createRateLimitKey, rateLimit } from "../../../platform/rate-limit/rate-limit";
import { currentStaff } from "../../../platform/http/authenticate";
import {
  confirmVehicleImageUpload,
  deleteVehicleImage,
  reorderVehicleImages,
  requestVehicleImageUpload,
} from "../application/vehicle-images";
import {
  archiveVehicle,
  createVehicle,
  getVehicle,
  listVehicles,
  restoreVehicle,
  updateVehicle,
} from "../application/vehicles";
import { actorOf, canRead, canWrite, security, staffProblems } from "./shared";

const tags = ["Vehicles"];
const notFound = problemResponse("NOT_FOUND: there's no such vehicle.");
const invalid = problemResponse("VALIDATION_FAILED");
const officeProblems = problemResponse(
  "OFFICE_NOT_AVAILABLE: the office doesn't exist or is archived. OFFICE_REQUIRES_EXTERNAL: only an external vehicle can come from an office.",
);

const ImageParams = z.object({
  id: z.string().min(1, "Id is required."),
  imageId: z.string().min(1, "Image is required."),
});

// A browser's File (FormData) or Node's, both Blobs.
const list = createRoute({
  method: "get",
  path: "/staff/vehicles",
  tags,
  summary: "List vehicles",
  description:
    "Live vehicles by default, by make, model and plate. `q` matches every word against the make, model, plate number and color. Pass `nextCursor` back as `cursor` for the next page.",
  middleware: canRead,
  security,
  request: { query: ListVehicles },
  responses: {
    200: { description: "One page of vehicles", ...json(page(Vehicle)) },
    400: invalid,
    ...staffProblems,
  },
});

const create = createRoute({
  method: "post",
  path: "/staff/vehicles",
  tags,
  summary: "Add a vehicle",
  middleware: canWrite,
  security,
  request: body(CreateVehicle),
  responses: {
    201: { description: "Added", ...json(Vehicle) },
    400: invalid,
    ...staffProblems,
    409: problemResponse("PLATE_NUMBER_TAKEN"),
    422: officeProblems,
  },
});

const get = createRoute({
  method: "get",
  path: "/staff/vehicles/{id}",
  tags,
  summary: "Get a vehicle",
  middleware: canRead,
  security,
  request: { params: IdParam },
  responses: {
    200: { description: "The vehicle", ...json(Vehicle) },
    ...staffProblems,
    404: notFound,
  },
});

const update = createRoute({
  method: "patch",
  path: "/staff/vehicles/{id}",
  tags,
  summary: "Change a vehicle",
  description: "Only the fields sent change; null clears an optional one.",
  middleware: canWrite,
  security,
  request: { params: IdParam, ...body(UpdateVehicle) },
  responses: {
    200: { description: "Changed", ...json(Vehicle) },
    400: invalid,
    ...staffProblems,
    404: notFound,
    409: problemResponse("PLATE_NUMBER_TAKEN"),
    422: officeProblems,
  },
});

const archive = createRoute({
  method: "post",
  path: "/staff/vehicles/{id}/archive",
  tags,
  summary: "Archive a vehicle",
  description:
    "Archived vehicles can't be assigned. Refused while the vehicle is on a pending, confirmed or in-progress trip.",
  middleware: canWrite,
  security,
  request: { params: IdParam },
  responses: {
    200: { description: "Archived", ...json(Vehicle) },
    ...staffProblems,
    404: notFound,
    409: problemResponse("HAS_UPCOMING_TRIPS: `trips` lists them."),
  },
});

const restore = createRoute({
  method: "post",
  path: "/staff/vehicles/{id}/restore",
  tags,
  summary: "Restore an archived vehicle",
  middleware: canWrite,
  security,
  request: { params: IdParam },
  responses: {
    200: { description: "Restored", ...json(Vehicle) },
    ...staffProblems,
    404: notFound,
  },
});

const requestUpload = createRoute({
  method: "post",
  path: "/staff/vehicles/{id}/images/uploads",
  tags,
  summary: "Ask to upload an image",
  description:
    "Step one of adding an image: a link signed for one JPEG, PNG or WebP of up to 5 MB. PUT the file to `url` with `headers` (the file never passes through the API), then confirm it with POST /staff/vehicles/{id}/images. Refused when the vehicle has 5 images already.",
  middleware: [
    ...canWrite,
    rateLimit({
      limit: 120,
      windowMs: 60 * 60 * 1000,
      key: (c) => createRateLimitKey("staff:vehicle-images", "user", currentStaff(c).staffId),
    }),
  ],
  security,
  request: { params: IdParam, ...body(RequestVehicleImageUpload) },
  responses: {
    201: { description: "Where to put the file", ...json(VehicleImageUpload) },
    400: invalid,
    ...staffProblems,
    404: notFound,
    409: problemResponse("IMAGE_LIMIT_REACHED: delete an image first."),
    429: problemResponse("RATE_LIMITED"),
  },
});

const addImage = createRoute({
  method: "post",
  path: "/staff/vehicles/{id}/images",
  tags,
  summary: "Add an uploaded image",
  description:
    "Step two: once the file is at its link, this checks it (5 MB at most, a JPEG, PNG or WebP judged from the bytes) and adds it after the others; the first image is the cover. A file that fails a check is deleted, and its upload with it.",
  middleware: canWrite,
  security,
  request: { params: IdParam, ...body(ConfirmVehicleImageUpload) },
  responses: {
    201: { description: "Added; the vehicle with its images", ...json(Vehicle) },
    400: invalid,
    ...staffProblems,
    404: problemResponse("NOT_FOUND: there's no such vehicle, or no such upload of yours for it."),
    409: problemResponse(
      "IMAGE_LIMIT_REACHED: delete an image first. UPLOAD_INCOMPLETE: the file isn't at its link yet.",
    ),
    413: problemResponse("PAYLOAD_TOO_LARGE: 5 MB at most."),
    422: problemResponse("IMAGE_TYPE_NOT_ALLOWED: only JPEG, PNG or WebP."),
  },
});

const deleteImage = createRoute({
  method: "delete",
  path: "/staff/vehicles/{id}/images/{imageId}",
  tags,
  summary: "Delete an image",
  description: "The images after it move up; if it was the cover, the next one becomes the cover.",
  middleware: canWrite,
  security,
  request: { params: ImageParams },
  responses: {
    200: { description: "Deleted; the vehicle with its images", ...json(Vehicle) },
    ...staffProblems,
    404: problemResponse("NOT_FOUND: there's no such vehicle or image."),
  },
});

const reorderImages = createRoute({
  method: "put",
  path: "/staff/vehicles/{id}/images/order",
  tags,
  summary: "Reorder the images",
  description: "List every image of the vehicle once, in the new order; the first is the cover.",
  middleware: canWrite,
  security,
  request: { params: IdParam, ...body(ReorderVehicleImages) },
  responses: {
    200: { description: "Reordered; the vehicle with its images", ...json(Vehicle) },
    400: problemResponse("VALIDATION_FAILED: not every image of the vehicle, once each."),
    ...staffProblems,
    404: notFound,
  },
});

export const vehicleRoutes = createRouter()
  .openapi(list, async (c) => c.json(await listVehicles(c.req.valid("query")), 200))
  .openapi(create, async (c) => c.json(await createVehicle(c.req.valid("json"), actorOf(c)), 201))
  .openapi(get, async (c) => c.json(await getVehicle(c.req.valid("param").id), 200))
  .openapi(update, async (c) =>
    c.json(await updateVehicle(c.req.valid("param").id, c.req.valid("json"), actorOf(c)), 200),
  )
  .openapi(archive, async (c) =>
    c.json(await archiveVehicle(c.req.valid("param").id, actorOf(c)), 200),
  )
  .openapi(restore, async (c) =>
    c.json(await restoreVehicle(c.req.valid("param").id, actorOf(c)), 200),
  )
  .openapi(requestUpload, async (c) =>
    c.json(
      await requestVehicleImageUpload(c.req.valid("param").id, c.req.valid("json"), actorOf(c)),
      201,
    ),
  )
  .openapi(addImage, async (c) =>
    c.json(
      await confirmVehicleImageUpload(c.req.valid("param").id, c.req.valid("json"), actorOf(c)),
      201,
    ),
  )
  .openapi(deleteImage, async (c) => {
    const { id, imageId } = c.req.valid("param");
    return c.json(await deleteVehicleImage(id, imageId, actorOf(c)), 200);
  })
  .openapi(reorderImages, async (c) =>
    c.json(
      await reorderVehicleImages(c.req.valid("param").id, c.req.valid("json"), actorOf(c)),
      200,
    ),
  );
