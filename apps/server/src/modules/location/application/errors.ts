import { AppError } from "../../../platform/errors/app-error";

export const locationNotFound = () =>
  new AppError({ code: "NOT_FOUND", status: 404, detail: "There's no location with this id." });

export const locationDeleted = () =>
  new AppError({
    code: "LOCATION_DELETED",
    status: 409,
    detail: "This location is deleted. Restore it before changing it.",
  });

export const governorateReadOnly = () =>
  new AppError({
    code: "GOVERNORATE_READ_ONLY",
    status: 409,
    detail:
      "Governorates come from the seed: they can be renamed, but not moved, reshaped or deleted.",
  });

export const parentInvalid = (detail: string) =>
  new AppError({ code: "LOCATION_PARENT_INVALID", status: 409, detail });

// Turning `flexible` on for something that can't be booked as a whole: a district, an area, or a governorate without its
// outline.
export const notFlexible = (detail: string) =>
  new AppError({ code: "LOCATION_NOT_FLEXIBLE", status: 409, detail });

export const nameTaken = () =>
  new AppError({
    code: "LOCATION_NAME_TAKEN",
    status: 409,
    detail: "Another live location in the same parent already has this name.",
  });

export const notRestorable = (detail: string) =>
  new AppError({ code: "LOCATION_NOT_RESTORABLE", status: 409, detail });

export const countMismatch = (count: number) =>
  new AppError({
    code: "LOCATION_COUNT_MISMATCH",
    status: 409,
    detail: `This delete would remove ${count} ${count === 1 ? "location" : "locations"}. Check them and send that count.`,
    extensions: { count },
  });
