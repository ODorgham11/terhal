import {
  auditActions,
  normalizeSearch,
  type BulkPricing,
  type BulkPricingResult,
  type CarBody,
  type CreatePricing,
  type ListPricing,
  type PricingEntry,
  type PricingRow,
  type ValidationIssue,
} from "@terhal/contracts";
import type { Prisma } from "../../../../generated/prisma/client";
import { violatedUniqueIndex } from "../../../platform/db/errors";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { validationFailed } from "../../../platform/errors/validation";
import { recordAudit, recordAudits, type AuditActor, type AuditEntry } from "../../audit/index";
import { toCsv } from "../domain/csv";
import { entryKey, entryProblems, type EntryRefs, type Known } from "../domain/entries";

type Client = typeof prisma | Prisma.TransactionClient;

const place = { select: { id: true, locality: true, nameEn: true, nameAr: true, deletedAt: true } };

const select = {
  id: true,
  car: true,
  price: true,
  updatedAt: true,
  from: place,
  to: place,
  class: { select: { id: true, nameEn: true, nameAr: true, archivedAt: true } },
} satisfies Prisma.PricingSelect;

type Row = Prisma.PricingGetPayload<{ select: typeof select }>;

const toPlace = ({ deletedAt, ...rest }: Row["from"]) => ({ ...rest, deleted: deletedAt !== null });

// Prisma models never leave the server: every response is an explicit DTO.
const toRow = (row: Row): PricingRow => ({
  id: row.id,
  from: toPlace(row.from),
  to: toPlace(row.to),
  class: {
    id: row.class.id,
    nameEn: row.class.nameEn,
    nameAr: row.class.nameAr,
    archived: row.class.archivedAt !== null,
  },
  car: row.car,
  price: row.price.toFixed(2),
  active: row.class.archivedAt === null && !row.from.deletedAt && !row.to.deletedAt,
  updatedAt: row.updatedAt.toISOString(),
});

// What the audit log keeps of a price row (P5: who changed it, when, and from what to what).
const snapshot = (entry: EntryRefs & { price: string }) => ({
  fromId: entry.fromId,
  toId: entry.toId,
  classId: entry.classId,
  car: entry.car,
  price: entry.price,
});

export const pricingNotFound = () =>
  new AppError({ code: "NOT_FOUND", status: 404, detail: "There's no price with this id." });

const pricingExists = () =>
  new AppError({
    code: "PRICING_EXISTS",
    status: 409,
    detail: "This route already has a price for this class and car body. Change that one instead.",
  });

const uniqueRow = async <T>(write: () => Promise<T>) => {
  try {
    return await write();
  } catch (error) {
    if (violatedUniqueIndex(error) === "Pricing_fromId_toId_classId_car_key") throw pricingExists();
    throw error;
  }
};

// The places and classes these entries point at, to check them before writing.
const knownFor = async (entries: readonly EntryRefs[], client: Client): Promise<Known> => {
  const placeIds = [...new Set(entries.flatMap((entry) => [entry.fromId, entry.toId]))];
  const classIds = [...new Set(entries.map((entry) => entry.classId))];
  const [places, classes] = await Promise.all([
    client.location.findMany({
      where: { id: { in: placeIds } },
      select: { id: true, locality: true, deletedAt: true },
    }),
    client.tripClass.findMany({
      where: { id: { in: classIds } },
      select: { id: true, archivedAt: true },
    }),
  ]);
  return {
    places: new Map(
      places.map((row) => [row.id, { locality: row.locality, deleted: row.deletedAt !== null }]),
    ),
    classes: new Map(classes.map((row) => [row.id, { archived: row.archivedAt !== null }])),
  };
};

const issue = (path: string, message: string): ValidationIssue => ({
  in: "json",
  path,
  code: "custom",
  message,
});

export const listPricing = async ({
  fromId,
  toId,
  classId,
  car,
  q,
  limit,
  cursor,
}: ListPricing) => {
  // Every word has to match either end's names, normalized like the location search.
  const words = q ? normalizeSearch(q).split(" ").filter(Boolean) : [];
  const rows = await prisma.pricing.findMany({
    where: {
      fromId,
      toId,
      classId,
      car,
      AND: words.map((word) => ({
        OR: [{ from: { search: { contains: word } } }, { to: { search: { contains: word } } }],
      })),
    },
    orderBy: [
      { from: { nameEn: "asc" } },
      { to: { nameEn: "asc" } },
      { class: { sortOrder: "asc" } },
      { car: "asc" },
      { id: "asc" },
    ],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    select,
  });
  const data = rows.slice(0, limit).map(toRow);
  return { data, nextCursor: rows.length > limit ? (data.at(-1)?.id ?? null) : null };
};

// Adds a price, and with bothWays the reverse direction at the same price (P2 a), together or not at all.
export const createPricing = async (input: CreatePricing, actor: AuditActor) =>
  uniqueRow(() =>
    prisma.$transaction(async (tx) => {
      const problems = entryProblems(input, await knownFor([input], tx));
      if (problems.length > 0) {
        throw validationFailed(problems.map(({ field, message }) => issue(field, message)));
      }

      const entries: PricingEntry[] = [input];
      if (input.bothWays && input.fromId !== input.toId) {
        entries.push({ ...input, fromId: input.toId, toId: input.fromId });
      }

      const created: Row[] = [];
      for (const entry of entries) {
        const row = await tx.pricing.create({
          data: {
            fromId: entry.fromId,
            toId: entry.toId,
            classId: entry.classId,
            car: entry.car,
            price: entry.price,
          },
          select,
        });
        await recordAudit(
          {
            ...actor,
            action: auditActions.PRICING_CREATED,
            entityType: "Pricing",
            entityId: row.id,
            after: snapshot(entry),
          },
          tx,
        );
        created.push(row);
      }
      return { data: created.map(toRow) };
    }),
  );

// Only the price changes: a different route, class or body is a different row.
export const updatePricing = async (id: string, price: string, actor: AuditActor) =>
  prisma.$transaction(async (tx) => {
    const before = await tx.pricing.findUnique({
      where: { id },
      select: { fromId: true, toId: true, classId: true, car: true, price: true },
    });
    if (!before) throw pricingNotFound();

    const row = await tx.pricing.update({ where: { id }, data: { price }, select });
    const old = before.price.toFixed(2);
    if (old !== price) {
      await recordAudit(
        {
          ...actor,
          action: auditActions.PRICING_UPDATED,
          entityType: "Pricing",
          entityId: id,
          before: snapshot({ ...before, price: old }),
          after: snapshot({ ...before, price }),
        },
        tx,
      );
    }
    return toRow(row);
  });

// Sets the price of one route, class and body, adding the row or changing it, inside the caller's transaction. For a
// price staff propose on a trip and save to the price list (Q3 follow-ups: `saveToPricing`). Audited like any change.
export const savePrice = async (
  entry: EntryRefs & { price: string },
  actor: AuditActor,
  tx: Prisma.TransactionClient,
) => {
  const where = {
    fromId_toId_classId_car: {
      fromId: entry.fromId,
      toId: entry.toId,
      classId: entry.classId,
      car: entry.car,
    },
  };
  const before = await tx.pricing.findUnique({ where, select: { id: true, price: true } });
  if (before?.price.toFixed(2) === entry.price) return;

  const row = await tx.pricing.upsert({
    where,
    create: { ...snapshot(entry) },
    update: { price: entry.price },
    select: { id: true },
  });
  await recordAudit(
    {
      ...actor,
      action: before ? auditActions.PRICING_UPDATED : auditActions.PRICING_CREATED,
      entityType: "Pricing",
      entityId: row.id,
      ...(before && { before: snapshot({ ...entry, price: before.price.toFixed(2) }) }),
      after: snapshot(entry),
    },
    tx,
  );
};

export const deletePricing = async (id: string, actor: AuditActor) =>
  prisma.$transaction(async (tx) => {
    const row = await tx.pricing.findUnique({
      where: { id },
      select: { fromId: true, toId: true, classId: true, car: true, price: true },
    });
    if (!row) throw pricingNotFound();
    await tx.pricing.delete({ where: { id } });
    await recordAudit(
      {
        ...actor,
        action: auditActions.PRICING_DELETED,
        entityType: "Pricing",
        entityId: id,
        before: snapshot({ ...row, price: row.price.toFixed(2) }),
      },
      tx,
    );
  });

// Adds or updates up to 500 prices in one transaction: if any row is invalid, nothing is saved and every problem is
// listed (rows.<index>.<field>). Each added or changed price is audited with before and after.
export const bulkPricing = async (
  { rows }: BulkPricing,
  actor: AuditActor,
): Promise<BulkPricingResult> => {
  const known = await knownFor(rows, prisma);
  const errors: ValidationIssue[] = [];
  const seen = new Map<string, number>();
  rows.forEach((row, index) => {
    for (const { field, message } of entryProblems(row, known)) {
      errors.push(issue(`rows.${String(index)}.${field}`, message));
    }
    const key = entryKey(row);
    const first = seen.get(key);
    if (first === undefined) seen.set(key, index);
    else {
      errors.push(
        issue(
          `rows.${String(index)}`,
          `Repeats row ${String(first)}: the same route, class and car body.`,
        ),
      );
    }
  });
  if (errors.length > 0) throw validationFailed(errors);

  return uniqueRow(() =>
    prisma.$transaction(
      async (tx) => {
        // The rows already priced, locked so two uploads can't interleave their changes.
        const existing = await tx.$queryRaw<
          {
            id: string;
            fromId: string;
            toId: string;
            classId: string;
            car: CarBody;
            price: string;
          }[]
        >`
          SELECT p."id", p."fromId", p."toId", p."classId", p."car"::text AS "car", p."price"::text AS "price"
          FROM "Pricing" p
          JOIN unnest(
              ${rows.map((row) => row.fromId)}::text[], ${rows.map((row) => row.toId)}::text[],
              ${rows.map((row) => row.classId)}::text[], ${rows.map((row) => row.car)}::text[]
          ) AS wanted("fromId", "toId", "classId", "car")
              ON p."fromId" = wanted."fromId" AND p."toId" = wanted."toId"
              AND p."classId" = wanted."classId" AND p."car"::text = wanted."car"
          FOR UPDATE OF p`;
        const byKey = new Map(existing.map((row) => [entryKey(row), row]));

        const toCreate = rows.filter((row) => !byKey.has(entryKey(row)));
        const toUpdate = rows.flatMap((row) => {
          const current = byKey.get(entryKey(row));
          return current && Number(current.price).toFixed(2) !== row.price
            ? [{ ...current, price: Number(current.price).toFixed(2), next: row.price }]
            : [];
        });

        const created = await tx.pricing.createManyAndReturn({
          data: toCreate.map(({ fromId, toId, classId, car, price }) => ({
            fromId,
            toId,
            classId,
            car,
            price,
          })),
          select: { id: true, fromId: true, toId: true, classId: true, car: true },
        });

        if (toUpdate.length > 0) {
          await tx.$executeRaw`
            UPDATE "Pricing" p SET "price" = changed."price", "updatedAt" = now()
            FROM unnest(
                ${toUpdate.map((row) => row.id)}::text[], ${toUpdate.map((row) => row.next)}::numeric[]
            ) AS changed("id", "price")
            WHERE p."id" = changed."id"`;
        }

        const prices = new Map(rows.map((row) => [entryKey(row), row.price]));
        const entries: AuditEntry[] = [
          ...created.map((row) => ({
            ...actor,
            action: auditActions.PRICING_CREATED,
            entityType: "Pricing",
            entityId: row.id,
            after: snapshot({ ...row, price: prices.get(entryKey(row)) ?? "" }),
          })),
          ...toUpdate.map((row) => ({
            ...actor,
            action: auditActions.PRICING_UPDATED,
            entityType: "Pricing",
            entityId: row.id,
            before: snapshot(row),
            after: snapshot({ ...row, price: row.next }),
          })),
        ];
        await recordAudits(entries, tx);

        return {
          created: created.length,
          updated: toUpdate.length,
          unchanged: rows.length - created.length - toUpdate.length,
        };
      },
      { timeout: 30_000 },
    ),
  );
};

const CSV_HEADER = [
  "fromId",
  "fromNameEn",
  "fromNameAr",
  "toId",
  "toNameEn",
  "toNameAr",
  "classId",
  "classNameEn",
  "classNameAr",
  "car",
  "price",
  "active",
] as const;

// The whole price list as CSV, in the list's order. The id, car and price columns are what a bulk upload takes, so an
// edited export can be sent back.
export const exportPricing = async () => {
  const rows = await prisma.pricing.findMany({
    orderBy: [
      { from: { nameEn: "asc" } },
      { to: { nameEn: "asc" } },
      { class: { sortOrder: "asc" } },
      { car: "asc" },
      { id: "asc" },
    ],
    select,
  });
  return toCsv(
    CSV_HEADER,
    rows
      .map(toRow)
      .map((row) => [
        row.from.id,
        row.from.nameEn,
        row.from.nameAr,
        row.to.id,
        row.to.nameEn,
        row.to.nameAr,
        row.class.id,
        row.class.nameEn,
        row.class.nameAr,
        row.car,
        row.price,
        row.active ? "true" : "false",
      ]),
  );
};
