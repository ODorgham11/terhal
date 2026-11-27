import type { Locale, ReportLink } from "@terhal/contracts";
import type { Prisma, Trip } from "../../../../generated/prisma/client";
import { env } from "../../../platform/config/env";
import { generateToken, hashToken, keyedToken } from "../../../platform/crypto/tokens";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import {
  reportLinkExpiry,
  reportLinkMessage,
  reportTokenMessage,
  reportUrl,
  whatsappUrl,
} from "../domain/report";
import { tripNotFound } from "./shared";

// The driver's report link (D1 b, D2 a): `<site>/report#<token>`, one per trip and driver. The token is a keyed HMAC of
// the trip, the driver and a random salt, so staff can be shown the same link again; the trip keeps only the token's
// hash (to find the trip from it) and the salt. Assigning another driver clears the columns (assignment.ts), and a new
// link is issued straight after (onDriverChanged).

const tokenFor = (tripId: string, driverId: string, salt: string) =>
  keyedToken(env.REPORT_LINK_SECRET, reportTokenMessage(tripId, driverId, salt));

// The columns of a fresh link for this trip and driver; any earlier link stops working.
export const newReportLink = (trip: { id: string; pickupDate: Date }, driverId: string) => {
  const salt = generateToken();
  return {
    reportTokenHash: hashToken(tokenFor(trip.id, driverId, salt)),
    reportTokenSalt: salt,
    reportTokenExpiresAt: reportLinkExpiry(trip.pickupDate),
  };
};

// On assignment (onDriverChanged): a trip with a new driver gets a new link. No event of its own: the assignment's
// event already says the driver changed.
export const issueReportLink = async (
  tx: Prisma.TransactionClient,
  trip: { id: string; driverId: string | null },
) => {
  if (!trip.driverId) return;
  const { pickupDate } = await tx.trip.findUniqueOrThrow({
    where: { id: trip.id },
    select: { pickupDate: true },
  });
  await tx.trip.update({
    where: { id: trip.id },
    data: newReportLink({ id: trip.id, pickupDate }, trip.driverId),
  });
};

export const linkUnavailable = () =>
  new AppError({
    code: "REPORT_LINK_UNAVAILABLE",
    status: 409,
    detail: "This trip has no driver, so it has no report link.",
  });

// The link as staff send it: to copy, or as a WhatsApp chat with the driver with the message prefilled.
export const readReportLink = async (tripId: string, locale: Locale): Promise<ReportLink> => {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      id: true,
      code: true,
      pickupDate: true,
      reportTokenHash: true,
      reportTokenSalt: true,
      reportTokenExpiresAt: true,
      driver: { select: { id: true, firstName: true, lastName: true, phone: true } },
      brand: { select: { nameEn: true, nameAr: true, phone: true } },
    },
  });
  if (!trip) throw tripNotFound();
  const { driver, reportTokenSalt: salt, reportTokenExpiresAt: expiresAt } = trip;
  if (!driver || !salt || !expiresAt) throw linkUnavailable();

  const token = tokenFor(trip.id, driver.id, salt);
  // A link made for another driver can't be shown as this one's.
  if (hashToken(token) !== trip.reportTokenHash) throw linkUnavailable();

  const url = reportUrl(env.SITE_URL, token);
  const message = reportLinkMessage(
    {
      firstName: driver.firstName,
      code: trip.code,
      pickupDate: trip.pickupDate,
      url,
      brand: trip.brand,
    },
    locale,
  );
  return {
    url,
    whatsappUrl: whatsappUrl(driver.phone, message),
    message,
    expiresAt: expiresAt.toISOString(),
    driver,
  };
};

// --- The driver's side: the token from the link's fragment ---

export const linkInvalid = () =>
  new AppError({
    code: "REPORT_LINK_INVALID",
    status: 401,
    detail: "This report link doesn't work. It may have been replaced by a newer one.",
  });

// The trip a token opens, checked: it matches a trip that still has its driver, and hasn't expired.
export const checkReportToken = (
  trip: Trip | null,
  token: string,
  now = new Date(),
): Trip & { driverId: string } => {
  if (!trip?.driverId || trip.reportTokenHash !== hashToken(token)) throw linkInvalid();
  if (!trip.reportTokenExpiresAt || trip.reportTokenExpiresAt.getTime() <= now.getTime()) {
    throw new AppError({
      code: "REPORT_LINK_EXPIRED",
      status: 401,
      detail: "This report link has expired. Ask the office to fill in the report.",
    });
  }
  return { ...trip, driverId: trip.driverId };
};

export const tripForToken = async (
  client: Prisma.TransactionClient | typeof prisma,
  token: string,
) =>
  checkReportToken(
    await client.trip.findUnique({ where: { reportTokenHash: hashToken(token) } }),
    token,
  );
