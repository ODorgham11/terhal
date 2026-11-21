import { prisma } from "../../src/platform/db/prisma";
import { createTrip } from "./fleet";

// What the analytics tests share: trips written straight to the database, with a price, a pickup time and whatever
// else the figures read, and a report with expenses.

type Status =
  "PENDING" | "CONFIRMED" | "IN_PROGRESS" | "AWAITING_REPORT" | "COMPLETED" | "CANCELLED";

export interface TripSpec {
  status: Status;
  pickupDate: string;
  totalPrice?: string;
  source?: "CUSTOMER" | "STAFF";
  pickupId?: string;
  dropoffId?: string;
  driverId?: string;
  vehicleId?: string;
  officeId?: string;
  paid?: boolean;
  car?: "SEDAN" | "SUV" | "MINIVAN" | "VAN";
  clientName?: string;
  clientPhone?: string;
  expenses?: { type: "FUEL" | "OFFICE_FEE" | "DRIVER_FEE" | "INTERCITY_TOLL"; amount: string }[];
}

export const analyticsTrip = async ({ expenses, paid, ...spec }: TripSpec) => {
  const pickupDate = new Date(spec.pickupDate);
  const created = await createTrip({ status: "PENDING", pickupDate });
  const trip = await prisma.trip.update({
    where: { id: created.id },
    data: {
      status: spec.status,
      totalPrice: spec.totalPrice ?? "500.00",
      source: spec.source ?? "STAFF",
      car: spec.car ?? "SEDAN",
      ...(spec.pickupId && { pickupId: spec.pickupId }),
      ...(spec.dropoffId && { dropoffId: spec.dropoffId }),
      ...(spec.clientName && { clientName: spec.clientName }),
      ...(spec.clientPhone && { clientPhone: spec.clientPhone }),
      driverId: spec.driverId,
      vehicleId: spec.vehicleId,
      officeId: spec.officeId,
      ...(paid && { paymentMethod: "CASH_TO_DRIVER", paidAt: pickupDate }),
    },
  });
  if (expenses) {
    const hour = 60 * 60 * 1000;
    await prisma.tripReport.create({
      data: {
        tripId: trip.id,
        startedAt: pickupDate,
        vehiclePickup: "Garage",
        startMileage: 100,
        pickupAt: pickupDate,
        dropoffAt: new Date(pickupDate.getTime() + hour),
        vehicleDropoff: "Garage",
        endedAt: new Date(pickupDate.getTime() + 2 * hour),
        endMileage: 200,
        expenses: { create: expenses },
      },
    });
  }
  return trip;
};
