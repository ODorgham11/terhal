import {
  auditActions,
  normalizeSearch,
  type CreateLocation,
  type ListLocations,
  type Locality,
  type Location,
  type LocationDetail,
  type UpdateLocation,
} from "@terhal/contracts";
import type { Prisma } from "../../../../generated/prisma/client";
import { violatedUniqueIndex } from "../../../platform/db/errors";
import { prisma } from "../../../platform/db/prisma";
import { recordAudit, type AuditActor } from "../../audit/index";
import { canSitIn, restoreRefusal } from "../domain/tree";
import {
  countMismatch,
  governorateReadOnly,
  locationDeleted,
  locationNotFound,
  nameTaken,
  notRestorable,
  parentInvalid,
} from "./errors";
import { boundariesOf, chainsOf, liveSubtree, withBoundary, type Client } from "./queries";

const select = {
  id: true,
  parentId: true,
  locality: true,
  nameEn: true,
  nameAr: true,
  latitude: true,
  longitude: true,
  radius: true,
  deletedAt: true,
  deletedWithId: true,
} satisfies Prisma.LocationSelect;

type Row = Prisma.LocationGetPayload<{ select: typeof select }>;

const centerOf = (row: Pick<Row, "latitude" | "longitude" | "radius">) =>
  row.latitude !== null && row.longitude !== null && row.radius !== null
    ? { latitude: Number(row.latitude), longitude: Number(row.longitude), radius: row.radius }
    : null;

// Prisma models never leave the server: every response is an explicit DTO.
const toLocation = (row: Row, hasBoundary: boolean): Location => ({
  id: row.id,
  parentId: row.parentId,
  locality: row.locality,
  nameEn: row.nameEn,
  nameAr: row.nameAr,
  center: centerOf(row),
  hasBoundary,
  deletedAt: row.deletedAt?.toISOString() ?? null,
  deletedWithId: row.deletedWithId,
});

// What the audit log keeps of a location, before and after a change.
const snapshot = (row: Row) => ({
  parentId: row.parentId,
  locality: row.locality,
  nameEn: row.nameEn,
  nameAr: row.nameAr,
  center: centerOf(row),
});

const audit = (
  actor: AuditActor,
  action: (typeof auditActions)[
    "LOCATION_CREATED" | "LOCATION_UPDATED" | "LOCATION_DELETED" | "LOCATION_RESTORED"],
  entityId: string,
  change: { before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue },
  client: Client,
) => recordAudit({ ...actor, action, entityType: "Location", entityId, ...change }, client);

// A clash with a live sibling's name (the Location_live_sibling_* indexes) is the caller's to fix, not a bug.
const naming = async <T>(write: () => Promise<T>) => {
  try {
    return await write();
  } catch (error) {
    if (violatedUniqueIndex(error)?.startsWith("Location_live_sibling")) throw nameTaken();
    throw error;
  }
};

interface Locked {
  id: string;
  parentId: string | null;
  locality: Locality;
  deletedAt: Date | null;
  deletedWithId: string | null;
}

// Row locks, so a delete and a create (or a move, or a restore) under the same place can't both win: writes under a
// parent share-lock it and see a delete that committed while they waited.
const lockForUpdate = async (client: Client, id: string) =>
  (
    await client.$queryRaw<Locked[]>`
      SELECT "id", "parentId", "locality"::text AS "locality", "deletedAt", "deletedWithId"
      FROM "Location" WHERE "id" = ${id} FOR UPDATE`
  )[0] ?? null;

const lockForShare = async (client: Client, id: string) =>
  (
    await client.$queryRaw<Locked[]>`
      SELECT "id", "parentId", "locality"::text AS "locality", "deletedAt", "deletedWithId"
      FROM "Location" WHERE "id" = ${id} FOR SHARE`
  )[0] ?? null;

// The new parent of a district or an area: it must exist, be live and be broader (L1).
const requireParent = async (client: Client, parentId: string, locality: Locality) => {
  const parent = await lockForShare(client, parentId);
  if (!parent) throw parentInvalid("There's no location with the parent's id.");
  if (parent.deletedAt) throw parentInvalid("The parent is deleted. Restore it first.");
  if (!canSitIn(locality, parent.locality)) {
    throw parentInvalid(
      locality === "DISTRICT"
        ? "A district goes directly in a governorate."
        : "An area goes in a district or directly in a governorate.",
    );
  }
  return parent;
};

export const listLocations = async ({
  parentId,
  locality,
  q,
  deleted,
  limit,
  cursor,
}: ListLocations) => {
  // Every word has to match, against both names normalized (the search column), so "الاسكندريه" finds "الإسكندرية".
  const words = q ? normalizeSearch(q).split(" ").filter(Boolean) : [];
  const rows = await prisma.location.findMany({
    where: {
      parentId,
      locality,
      deletedAt: deleted ? { not: null } : null,
      AND: words.map((word) => ({ search: { contains: word } })),
    },
    orderBy: [{ nameEn: "asc" }, { id: "asc" }],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    select,
  });

  const page = rows.slice(0, limit);
  const outlined = await withBoundary(
    page.filter((row) => row.locality === "GOVERNORATE").map((row) => row.id),
  );
  const data = page.map((row) => toLocation(row, outlined.has(row.id)));
  return { data, nextCursor: rows.length > limit ? (data.at(-1)?.id ?? null) : null };
};

const upcoming = { status: { in: ["PENDING" as const, "CONFIRMED" as const] } };

// One location with its outline, ancestors, the size of its live subtree (what a delete would remove) and what still
// uses it (L4: deleting is allowed anyway, the counts are there to warn first).
export const getLocation = async (id: string): Promise<LocationDetail> => {
  const row = await prisma.location.findUnique({
    where: { id },
    select: {
      ...select,
      _count: {
        select: { offices: true, pickups: { where: upcoming }, dropoffs: { where: upcoming } },
      },
    },
  });
  if (!row) throw locationNotFound();

  const [chains, boundaries, subtree, [pricing]] = await Promise.all([
    chainsOf([id]),
    boundariesOf([id]),
    liveSubtree(id),
    prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS "count" FROM "Pricing" WHERE "fromId" = ${id} OR "toId" = ${id}`,
  ]);
  const boundary = boundaries.get(id) ?? null;

  return {
    ...toLocation(row, boundary !== null),
    boundary,
    ancestors: (chains.get(id) ?? []).slice(1).reverse(),
    subtreeSize: subtree.length,
    usage: {
      pricing: pricing?.count ?? 0,
      offices: row._count.offices,
      upcomingTrips: row._count.pickups + row._count.dropoffs,
    },
  };
};

// Districts and areas only: governorates come from the seed.
export const createLocation = async (input: CreateLocation, actor: AuditActor) =>
  naming(() =>
    prisma.$transaction(async (tx) => {
      await requireParent(tx, input.parentId, input.locality);
      const created = await tx.location.create({
        data: {
          parentId: input.parentId,
          locality: input.locality,
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          latitude: input.center.latitude.toFixed(6),
          longitude: input.center.longitude.toFixed(6),
          radius: input.center.radius,
        },
        select,
      });
      await audit(
        actor,
        auditActions.LOCATION_CREATED,
        created.id,
        { after: snapshot(created) },
        tx,
      );
      return toLocation(created, false);
    }),
  );

// Renames, moves (L5) or reshapes a live location. A governorate is only renamed.
export const updateLocation = async (id: string, input: UpdateLocation, actor: AuditActor) =>
  naming(() =>
    prisma.$transaction(async (tx) => {
      const locked = await lockForUpdate(tx, id);
      if (!locked) throw locationNotFound();
      if (locked.deletedAt) throw locationDeleted();
      if (locked.locality === "GOVERNORATE" && (input.parentId !== undefined || input.center)) {
        throw governorateReadOnly();
      }
      if (input.parentId !== undefined && input.parentId !== locked.parentId) {
        if (input.parentId === id) throw parentInvalid("A location can't sit in itself.");
        await requireParent(tx, input.parentId, locked.locality);
      }

      const before = await tx.location.findUniqueOrThrow({ where: { id }, select });
      const after = await tx.location.update({
        where: { id },
        data: {
          parentId: input.parentId,
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          ...(input.center && {
            latitude: input.center.latitude.toFixed(6),
            longitude: input.center.longitude.toFixed(6),
            radius: input.center.radius,
          }),
        },
        select,
      });
      await audit(
        actor,
        auditActions.LOCATION_UPDATED,
        id,
        { before: snapshot(before), after: snapshot(after) },
        tx,
      );
      const outlined = await withBoundary([id], tx);
      return toLocation(after, outlined.has(id));
    }),
  );

// Soft-deletes a location with its whole live subtree (L3), marking each row with the location the delete started from
// so a restore brings back exactly these. `expectedCount` is what the caller saw (the detail's subtreeSize): a
// different count means the tree changed since, and nothing is deleted.
export const deleteLocation = async (id: string, expectedCount: number, actor: AuditActor) =>
  prisma.$transaction(async (tx) => {
    const locked = await lockForUpdate(tx, id);
    if (!locked) throw locationNotFound();
    if (locked.locality === "GOVERNORATE") throw governorateReadOnly();
    if (locked.deletedAt) throw locationDeleted();

    // Lock the subtree, then look again: a child created before the lock is in the second look, and one created after
    // waits on its parent's lock and then sees it deleted.
    let ids = await liveSubtree(id, tx);
    for (let attempt = 0; attempt < 5; attempt++) {
      await tx.$queryRaw`SELECT "id" FROM "Location" WHERE "id" = ANY(${ids}::text[]) FOR UPDATE`;
      const again = await liveSubtree(id, tx);
      const stable = again.length === ids.length && again.every((value) => ids.includes(value));
      ids = again;
      if (stable) break;
    }

    if (ids.length !== expectedCount) throw countMismatch(ids.length);

    await tx.location.updateMany({
      where: { id: { in: ids } },
      data: { deletedAt: new Date(), deletedWithId: id },
    });
    await audit(
      actor,
      auditActions.LOCATION_DELETED,
      id,
      { after: { count: ids.length, locationIds: ids } },
      tx,
    );
    return { count: ids.length };
  });

// Brings back everything one delete removed (L3, L6). Only the location the delete started from can be restored, while
// its parent is live; a descendant deleted earlier on its own stays deleted.
export const restoreLocation = async (id: string, actor: AuditActor) =>
  naming(() =>
    prisma.$transaction(async (tx) => {
      const locked = await lockForUpdate(tx, id);
      if (!locked) throw locationNotFound();
      const parent = locked.parentId ? await lockForShare(tx, locked.parentId) : null;

      const refusal = restoreRefusal(locked, parent);
      if (refusal === "not_deleted") throw notRestorable("This location isn't deleted.");
      if (refusal === "deleted_with_another") {
        throw notRestorable(
          "This location was deleted along with another one. Restore that one instead (deletedWithId).",
        );
      }
      if (refusal === "parent_deleted") {
        throw notRestorable("Its parent is deleted. Restore the parent first.");
      }

      const rows = await tx.location.findMany({
        where: { deletedWithId: id },
        select: { id: true },
      });
      await tx.location.updateMany({
        where: { deletedWithId: id },
        data: { deletedAt: null, deletedWithId: null },
      });
      const ids = rows.map((row) => row.id);
      await audit(
        actor,
        auditActions.LOCATION_RESTORED,
        id,
        { after: { count: ids.length, locationIds: ids } },
        tx,
      );
      return { count: ids.length };
    }),
  );
