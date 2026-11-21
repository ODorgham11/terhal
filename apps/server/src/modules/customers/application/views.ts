import {
  normalizeSearch,
  type CustomerDetail,
  type ListCustomerTrips,
  type ListCustomers,
} from "@terhal/contracts";
import type { Customer, Prisma, Trip } from "../../../../generated/prisma/client";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";

// Customers as staff and admins see them: a read-only view. Customers own their details (identity), and admins suspend
// them there. There's no trips module yet, so their trips are read here straight from the Trip table; once there is,
// this goes through its index instead.

const customerNotFound = () =>
  new AppError({ code: "NOT_FOUND", status: 404, detail: "There's no customer with this id." });

const toSummary = (customer: Customer) => ({
  id: customer.id,
  firstName: customer.firstName,
  lastName: customer.lastName,
  phone: customer.phone,
  email: customer.email,
  status: customer.status,
  locale: customer.locale,
  verifiedAt: customer.verifiedAt?.toISOString() ?? null,
  createdAt: customer.createdAt.toISOString(),
});

// One page, newest first. Every word searched for has to appear in the customer's normalized name, phone or email (the
// search column, kept up to date by a trigger), so "الاسكندريه" finds what was written "الإسكندرية". One extra row says
// whether there's another page, without counting the whole table.
export const listCustomers = async ({ q, status, cursor, limit }: ListCustomers) => {
  const words = q ? normalizeSearch(q).split(" ").filter(Boolean) : [];
  const rows = await prisma.customer.findMany({
    where: { status, AND: words.map((word) => ({ search: { contains: word } })) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });

  const data = rows.slice(0, limit).map(toSummary);
  return { data, nextCursor: rows.length > limit ? (data.at(-1)?.id ?? null) : null };
};

// With how many trips they've booked and what their completed trips came to.
export const getCustomer = async (customerId: string): Promise<CustomerDetail> => {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw customerNotFound();

  const [tripCount, completed] = await Promise.all([
    prisma.trip.count({ where: { customerId } }),
    prisma.trip.aggregate({
      where: { customerId, status: "COMPLETED" },
      _sum: { totalPrice: true },
    }),
  ]);

  return {
    ...toSummary(customer),
    tripCount,
    totalSpent: (completed._sum.totalPrice ?? 0).toFixed(2),
  };
};

const toTrip = (trip: Trip) => ({
  id: trip.id,
  code: trip.code,
  status: trip.status,
  source: trip.source,
  pickupDate: trip.pickupDate.toISOString(),
  pickup: trip.pickupSnapshot,
  dropoff: trip.dropoffSnapshot,
  car: trip.car,
  passengers: trip.passengers,
  totalPrice: trip.totalPrice?.toFixed(2) ?? null,
  priceState: trip.priceState,
  createdAt: trip.createdAt.toISOString(),
});

// The trips they booked (staff booking on their behalf included), latest pickup first, a page at a time.
export const listCustomerTrips = async (
  customerId: string,
  { status, cursor, limit }: ListCustomerTrips,
) => {
  if (!(await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } }))) {
    throw customerNotFound();
  }

  const where: Prisma.TripWhereInput = { customerId, status };
  const rows = await prisma.trip.findMany({
    where,
    orderBy: [{ pickupDate: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });

  const data = rows.slice(0, limit).map(toTrip);
  return { data, nextCursor: rows.length > limit ? (data.at(-1)?.id ?? null) : null };
};
