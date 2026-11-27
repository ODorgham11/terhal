import {
  auditActions,
  type Brand,
  type CreateBrand,
  type TripBrand,
  type UpdateBrand,
} from "@terhal/contracts";
import type { Prisma } from "../../../../generated/prisma/client";
import { violatedUniqueIndex } from "../../../platform/db/errors";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { validationFailed } from "../../../platform/errors/validation";
import { recordAudit, type AuditActor } from "../../audit/index";

// Brands a trip can be sent under instead of Terhal (docs/decisions.md, "Brands"). Terhal is built in: a trip without a
// brand is Terhal's.

const select = {
  id: true,
  nameEn: true,
  nameAr: true,
  senderEmail: true,
  replyTo: true,
  phone: true,
  website: true,
  isDefault: true,
  archivedAt: true,
} satisfies Prisma.BrandSelect;

type Row = Prisma.BrandGetPayload<{ select: typeof select }>;

const toBrand = (row: Row): Brand => ({
  ...row,
  archivedAt: row.archivedAt?.toISOString() ?? null,
});

// What the audit log keeps of a brand.
const snapshot = (row: Row) => ({
  nameEn: row.nameEn,
  nameAr: row.nameAr,
  senderEmail: row.senderEmail,
  replyTo: row.replyTo,
  phone: row.phone,
  website: row.website,
  isDefault: row.isDefault,
});

const order = [{ nameEn: "asc" }, { id: "asc" }] as const;

export const brandNotFound = () =>
  new AppError({ code: "NOT_FOUND", status: 404, detail: "There's no brand with this id." });

// Two active brands never share a name (the Brand_active_name* indexes).
const naming = async <T>(write: () => Promise<T>) => {
  try {
    return await write();
  } catch (error) {
    if (violatedUniqueIndex(error)?.startsWith("Brand_active_name")) {
      throw new AppError({
        code: "BRAND_NAME_TAKEN",
        status: 409,
        detail: "Another active brand already has this name.",
      });
    }
    throw error;
  }
};

const audit = (
  actor: AuditActor,
  action: (typeof auditActions)[
    "BRAND_CREATED" | "BRAND_UPDATED" | "BRAND_ARCHIVED" | "BRAND_RESTORED"],
  entityId: string,
  change: { before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue },
  client: Prisma.TransactionClient,
) => recordAudit({ ...actor, action, entityType: "Brand", entityId, ...change }, client);

// Making a brand the default takes it from whichever brand had it (Brand_one_default).
const clearDefault = (tx: Prisma.TransactionClient, exceptId?: string) =>
  tx.brand.updateMany({
    where: { isDefault: true, ...(exceptId && { id: { not: exceptId } }) },
    data: { isDefault: false },
  });

// Every active brand, or every archived one. There are only ever a few, so one page.
export const listBrands = async ({ archived }: { archived: boolean }) => {
  const rows = await prisma.brand.findMany({
    where: { archivedAt: archived ? { not: null } : null },
    orderBy: [...order],
    select,
  });
  return { data: rows.map(toBrand), nextCursor: null };
};

export const createBrand = async (input: CreateBrand, actor: AuditActor) =>
  naming(() =>
    prisma.$transaction(async (tx) => {
      if (input.isDefault) await clearDefault(tx);
      const created = await tx.brand.create({
        data: {
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          senderEmail: input.senderEmail,
          replyTo: input.replyTo ?? null,
          phone: input.phone ?? null,
          website: input.website ?? null,
          isDefault: input.isDefault ?? false,
        },
        select,
      });
      await audit(actor, auditActions.BRAND_CREATED, created.id, { after: snapshot(created) }, tx);
      return toBrand(created);
    }),
  );

// Trips already sent under the brand show its new name and send from its new details from now on; nothing is resent.
export const updateBrand = async (id: string, input: UpdateBrand, actor: AuditActor) =>
  naming(() =>
    prisma.$transaction(async (tx) => {
      const before = await tx.brand.findUnique({ where: { id }, select });
      if (!before) throw brandNotFound();
      if (input.isDefault && before.archivedAt) {
        throw validationFailed([
          {
            in: "json",
            path: "isDefault",
            code: "custom",
            message: "An archived brand can't be the default. Restore it first.",
          },
        ]);
      }
      if (input.isDefault) await clearDefault(tx, id);
      const after = await tx.brand.update({ where: { id }, data: input, select });
      await audit(
        actor,
        auditActions.BRAND_UPDATED,
        id,
        { before: snapshot(before), after: snapshot(after) },
        tx,
      );
      return toBrand(after);
    }),
  );

// Archiving takes the brand out of booking (and stops it being the default); trips under it keep it and its details.
// Restoring brings it back, unless an active brand took its name meanwhile. Either one repeated changes nothing.
const setArchived = (archived: boolean) => async (id: string, actor: AuditActor) =>
  naming(() =>
    prisma.$transaction(async (tx) => {
      const before = await tx.brand.findUnique({ where: { id }, select });
      if (!before) throw brandNotFound();
      if ((before.archivedAt !== null) === archived) return toBrand(before);

      const after = await tx.brand.update({
        where: { id },
        data: archived ? { archivedAt: new Date(), isDefault: false } : { archivedAt: null },
        select,
      });
      await audit(
        actor,
        archived ? auditActions.BRAND_ARCHIVED : auditActions.BRAND_RESTORED,
        id,
        {},
        tx,
      );
      return toBrand(after);
    }),
  );

export const archiveBrand = setArchived(true);
export const restoreBrand = setArchived(false);

// --- For trips ---

// The brand a new staff booking is sent under: the one picked (it must be active), Terhal for null, and the default
// brand (or Terhal without one) when nothing was sent.
export const brandForBooking = async (
  brandId: string | null | undefined,
): Promise<TripBrand | null> => {
  if (brandId === null) return null;
  const brand = await prisma.brand.findFirst({
    where: brandId === undefined ? { isDefault: true } : { id: brandId, archivedAt: null },
    select: { id: true, nameEn: true, nameAr: true },
  });
  if (!brand && brandId !== undefined) {
    throw validationFailed([
      {
        in: "json",
        path: "brandId",
        code: "custom",
        message: "There's no active brand with this id.",
      },
    ]);
  }
  return brand;
};
