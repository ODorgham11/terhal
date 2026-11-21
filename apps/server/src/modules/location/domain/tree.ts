import type { Locality } from "@terhal/contracts";

// The tree only narrows (L1): a governorate is at the top, a district sits in a governorate, an area in a district or
// directly in a governorate. The database holds the same rule (the Location_parent_broader trigger); this is checked
// first so the API can answer with a clear code.
export const canSitIn = (child: Locality, parent: Locality | null) => {
  if (child === "GOVERNORATE") return parent === null;
  if (child === "DISTRICT") return parent === "GOVERNORATE";
  return parent === "GOVERNORATE" || parent === "DISTRICT";
};

// Why a location can't be restored, if it can't (L6 and the deletedWithId proposal): it must be the location its own
// delete started from, and its parent (if any) must be live. Its name may still clash; the database catches that.
export const restoreRefusal = (
  location: { id: string; deletedAt: Date | null; deletedWithId: string | null },
  parent: { deletedAt: Date | null } | null,
): "not_deleted" | "deleted_with_another" | "parent_deleted" | null => {
  if (!location.deletedAt) return "not_deleted";
  if (location.deletedWithId !== location.id) return "deleted_with_another";
  if (parent?.deletedAt) return "parent_deleted";
  return null;
};
