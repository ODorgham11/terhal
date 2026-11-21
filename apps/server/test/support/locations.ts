import { prisma } from "../../src/platform/db/prisma";

// Locations written straight to the database, for tests that need a tree to work on.

// A governorate, with an outline given as [longitude, latitude] corners when it has one.
export const createGovernorate = async (
  nameEn: string,
  nameAr = `${nameEn} ع`,
  outline?: [number, number][],
) => {
  const governorate = await prisma.location.create({
    data: { locality: "GOVERNORATE", nameEn, nameAr },
  });
  if (outline) {
    const text = `(${outline.map(([x, y]) => `(${String(x)},${String(y)})`).join(",")})`;
    await prisma.$executeRaw`UPDATE "Location" SET "boundary" = ${text}::polygon WHERE "id" = ${governorate.id}`;
  }
  return governorate;
};

// A district or an area: a circle of `radius` meters around the center.
export const createPlace = (
  parentId: string,
  locality: "DISTRICT" | "AREA",
  nameEn: string,
  { latitude = 30, longitude = 31, radius = 10_000 } = {},
  nameAr = `${nameEn} ع`,
) =>
  prisma.location.create({
    data: {
      parentId,
      locality,
      nameEn,
      nameAr,
      latitude: latitude.toFixed(6),
      longitude: longitude.toFixed(6),
      radius,
    },
  });

// A square outline around a point, `half` degrees each way.
export const squareAround = (
  longitude: number,
  latitude: number,
  half = 0.5,
): [number, number][] => [
  [longitude - half, latitude - half],
  [longitude + half, latitude - half],
  [longitude + half, latitude + half],
  [longitude - half, latitude + half],
];
