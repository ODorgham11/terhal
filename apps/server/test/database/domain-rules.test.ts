import { carBodies, carCapacity, normalizeSearch } from "@terhal/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma";
import { resetDatabase } from "../support/database";

// The domain rules the migrations hold beyond Prisma's schema: checks, triggers, partial and expression indexes.

beforeEach(async () => {
  await resetDatabase();
});

const governorate = (nameEn = "Cairo", nameAr = "القاهرة") =>
  prisma.location.create({ data: { locality: "GOVERNORATE", nameEn, nameAr } });

const circle = { latitude: "30.000000", longitude: "31.000000", radius: 10_000 };

const child = (
  parentId: string,
  locality: "DISTRICT" | "AREA",
  nameEn: string,
  nameAr = `${nameEn} ع`,
) => prisma.location.create({ data: { parentId, locality, nameEn, nameAr, ...circle } });

describe("search normalization", () => {
  it("is the same in the database and in contracts", async () => {
    const samples = [
      "  الإسكندرية  ",
      "مُحَمَّد",
      "مكتبـــة",
      "آمنة إيمان ٱلقدس",
      "مستشفى",
      "٠١٠١٢٣٤٥٦٧٨٩",
      "Maadi   Degla",
      "+201001234567 Someone@Terhal.co",
    ];
    for (const sample of samples) {
      const [row] = await prisma.$queryRaw<{ value: string }[]>`
        SELECT search_normalize(${sample}) AS value`;
      expect(row?.value).toBe(normalizeSearch(sample));
    }
  });

  it("fills locations' and customers' search columns", async () => {
    const location = await governorate("Alexandria", "الإسكندرية");
    expect(location.search).toBe("alexandria الاسكندريه");

    const customer = await prisma.customer.create({
      data: {
        firstName: "Mona",
        lastName: "عبد الله",
        phone: "+201000000001",
        email: "mona@terhal.co",
        passwordHash: "x",
      },
    });
    expect(customer.search).toBe("mona عبد الله +201000000001 mona@terhal.co");

    // The app can't write it.
    const updated = await prisma.location.update({
      where: { id: location.id },
      data: { search: "anything" },
    });
    expect(updated.search).toBe("alexandria الاسكندريه");
  });
});

describe("the audit log", () => {
  it("names at most one actor", async () => {
    const admin = await prisma.admin.create({
      data: { firstName: "A", lastName: "B", email: "a@terhal.co", passwordHash: "x" },
    });
    const staff = await prisma.staff.create({
      data: {
        firstName: "S",
        lastName: "T",
        email: "s@terhal.co",
        passwordHash: "x",
        permissions: [],
      },
    });
    const entry = { action: "test", entityType: "Thing", entityId: "1" };

    for (const actor of [{}, { adminId: admin.id }, { staffId: staff.id }]) {
      await expect(prisma.auditLog.create({ data: { ...entry, ...actor } })).resolves.toBeDefined();
    }
    await expect(
      prisma.auditLog.create({ data: { ...entry, adminId: admin.id, staffId: staff.id } }),
    ).rejects.toThrow(/AuditLog_one_actor/);
  });
});

describe("the location tree", () => {
  it("only narrows: districts in governorates, areas in districts or governorates", async () => {
    const cairo = await governorate();
    const maadi = await child(cairo.id, "DISTRICT", "Maadi");
    await expect(child(maadi.id, "AREA", "Degla")).resolves.toBeDefined();
    await expect(child(cairo.id, "AREA", "Airport")).resolves.toBeDefined();

    await expect(child(maadi.id, "DISTRICT", "Inner")).rejects.toThrow(/Location_parent_broader/);
    await expect(
      prisma.location.create({
        data: { locality: "DISTRICT", nameEn: "Orphan", nameAr: "يتيم", ...circle },
      }),
    ).rejects.toThrow(/Location_parent_broader/);
    await expect(
      prisma.location.create({
        data: { parentId: cairo.id, locality: "GOVERNORATE", nameEn: "Giza", nameAr: "الجيزة" },
      }),
    ).rejects.toThrow(/Location_parent_broader/);
  });

  it("never changes a location's locality", async () => {
    const cairo = await governorate();
    const area = await child(cairo.id, "AREA", "Airport");
    await expect(
      prisma.location.update({ where: { id: area.id }, data: { locality: "DISTRICT" } }),
    ).rejects.toThrow(/Location_parent_broader/);
  });

  it("keeps live siblings' names unique in each language, ignoring case and Arabic spelling", async () => {
    const cairo = await governorate();
    const giza = await governorate("Giza", "الجيزة");
    const maadi = await child(cairo.id, "DISTRICT", "Maadi", "المعادي");

    await expect(child(cairo.id, "DISTRICT", "MAADI", "آخر")).rejects.toThrow(
      /Location_live_sibling_nameEn/,
    );
    await expect(child(cairo.id, "DISTRICT", "Other", "المعادى")).rejects.toThrow(
      /Location_live_sibling_nameAr/,
    );
    await expect(governorate("cairo", "مدينة")).rejects.toThrow(/Location_live_sibling_nameEn/);
    // Another parent, or a deleted sibling, is fine.
    await expect(child(giza.id, "DISTRICT", "Maadi", "المعادي")).resolves.toBeDefined();
    await prisma.location.update({
      where: { id: maadi.id },
      data: { deletedAt: new Date(), deletedWithId: maadi.id },
    });
    await expect(child(cairo.id, "DISTRICT", "Maadi", "المعادي")).resolves.toBeDefined();
  });

  it("records which delete removed a location", async () => {
    const cairo = await governorate();
    await expect(
      prisma.location.update({ where: { id: cairo.id }, data: { deletedAt: new Date() } }),
    ).rejects.toThrow(/Location_deleted_with/);
    await expect(
      prisma.location.update({ where: { id: cairo.id }, data: { deletedWithId: cairo.id } }),
    ).rejects.toThrow(/Location_deleted_with/);
  });
});

const driver = (data: { isExternal?: boolean; officeId?: string } = {}) =>
  prisma.driver.create({
    data: {
      firstName: "D",
      lastName: "R",
      phone: `+2010${Math.random().toString().slice(2, 10)}`,
      ...data,
    },
  });

describe("a driver's identity", () => {
  it("has a 14-digit national ID, and no national ID or licence twice", async () => {
    await expect(
      prisma.driver.create({
        data: { firstName: "D", lastName: "R", phone: "+201011111111", nationalId: "123" },
      }),
    ).rejects.toThrow(/Driver_national_id_format/);
    await prisma.driver.create({
      data: {
        firstName: "D",
        lastName: "R",
        phone: "+201011111112",
        nationalId: "29801011234567",
        licenseNumber: "Ab-1",
      },
    });
    await expect(
      prisma.driver.create({
        data: {
          firstName: "D",
          lastName: "R",
          phone: "+201011111113",
          nationalId: "29801011234567",
        },
      }),
    ).rejects.toThrow(/nationalId/);
    await expect(
      prisma.driver.create({
        data: { firstName: "D", lastName: "R", phone: "+201011111114", licenseNumber: "AB-1" },
      }),
    ).rejects.toThrow(/Driver_licenseNumber_key|Unique constraint/);
  });
});

describe("the driver ledger", () => {
  it("is the only thing that moves a driver's balance", async () => {
    const { id } = await driver();
    await prisma.driverTransaction.create({
      data: { driverId: id, type: "ADJUSTMENT", amount: "150.00" },
    });
    await prisma.driverTransaction.create({
      data: { driverId: id, type: "PAYOUT", amount: "-100.00" },
    });
    expect((await prisma.driver.findUniqueOrThrow({ where: { id } })).amountOwed.toFixed(2)).toBe(
      "50.00",
    );

    await expect(
      prisma.driver.update({ where: { id }, data: { amountOwed: "0" } }),
    ).rejects.toThrow(/Driver_amount_owed_from_ledger/);
    await expect(
      prisma.driver.create({
        data: { firstName: "D", lastName: "R", phone: "+201099999999", amountOwed: "10" },
      }),
    ).rejects.toThrow(/Driver_amount_owed_from_ledger/);
  });

  it("is append-only, with signs fixed per kind and trips named where they're the source", async () => {
    const { id } = await driver();
    const entry = await prisma.driverTransaction.create({
      data: { driverId: id, type: "ADJUSTMENT", amount: "-5.00" },
    });
    await expect(
      prisma.driverTransaction.update({ where: { id: entry.id }, data: { note: "x" } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.driverTransaction.delete({ where: { id: entry.id } })).rejects.toThrow(
      /append-only/,
    );

    await expect(
      prisma.driverTransaction.create({ data: { driverId: id, type: "PAYOUT", amount: "10.00" } }),
    ).rejects.toThrow(/DriverTransaction_sign/);
    await expect(
      prisma.driverTransaction.create({ data: { driverId: id, type: "ADJUSTMENT", amount: "0" } }),
    ).rejects.toThrow(/DriverTransaction_sign/);
    await expect(
      prisma.driverTransaction.create({
        data: { driverId: id, type: "TRIP_FEE", amount: "10.00" },
      }),
    ).rejects.toThrow(/DriverTransaction_trip/);
  });
});

describe("vehicle images", () => {
  it("are at most 5, numbered from the cover", async () => {
    const vehicle = await prisma.vehicle.create({
      data: {
        make: "Toyota",
        model: "Corolla",
        plateNumber: "ABC 123",
        color: "White",
        body: "SEDAN",
      },
    });
    const image = (position: number) =>
      prisma.vehicleImage.create({
        data: { vehicleId: vehicle.id, bucket: "b", key: `k${position}`, position },
      });
    await expect(image(0)).resolves.toBeDefined();
    await expect(image(4)).resolves.toBeDefined();
    await expect(image(5)).rejects.toThrow(/VehicleImage_position/);
  });
});

const tripSetup = async () => {
  const [cairo, tripClass, staff] = await Promise.all([
    governorate(),
    prisma.tripClass.create({ data: { nameEn: "Economy", nameAr: "اقتصادي" } }),
    prisma.staff.create({
      data: {
        firstName: "S",
        lastName: "T",
        email: "s@terhal.co",
        passwordHash: "x",
        permissions: [],
      },
    }),
  ]);
  let code = 0;
  return (data: Record<string, unknown> = {}) =>
    prisma.trip.create({
      data: {
        code: `T-${++code}`,
        source: "STAFF",
        staffId: staff.id,
        classId: tripClass.id,
        classSnapshot: { nameEn: "Economy", nameAr: "اقتصادي" },
        clientName: "Client",
        clientPhone: "+201000000003",
        pickupDate: new Date(),
        smallLuggage: 0,
        mediumLuggage: 0,
        largeLuggage: 0,
        passengers: 1,
        car: "SEDAN",
        totalPrice: "100.00",
        pickupId: cairo.id,
        pickupSnapshot: "Cairo",
        pickupSnapshotAr: "Cairo",
        pickupLatitude: "30.044420",
        pickupLongitude: "31.235712",
        dropoffId: cairo.id,
        dropoffSnapshot: "Cairo",
        dropoffSnapshotAr: "Cairo",
        dropoffLatitude: "30.044420",
        dropoffLongitude: "31.235712",
        ...data,
      },
    });
};

describe("a trip's price", () => {
  it("is empty exactly while it's requested", async () => {
    const trip = await tripSetup();
    await expect(trip({ totalPrice: null, priceState: "REQUESTED" })).resolves.toBeDefined();
    await expect(trip({ totalPrice: null })).rejects.toThrow(/Trip_price_state/);
    await expect(trip({ priceState: "REQUESTED" })).rejects.toThrow(/Trip_price_state/);
    await expect(trip({ totalPrice: "0" })).rejects.toThrow(/Trip_price_positive/);
  });

  it("must be quoted or accepted before the trip is confirmed", async () => {
    const trip = await tripSetup();
    await expect(trip({ priceState: "PROPOSED", status: "PENDING" })).resolves.toBeDefined();
    await expect(trip({ priceState: "PROPOSED", status: "CANCELLED" })).resolves.toBeDefined();
    await expect(trip({ priceState: "ACCEPTED", status: "CONFIRMED" })).resolves.toBeDefined();
    await expect(trip({ priceState: "PROPOSED", status: "CONFIRMED" })).rejects.toThrow(
      /Trip_priced_before_confirmed/,
    );
  });

  it("is paid with a method", async () => {
    const trip = await tripSetup();
    await expect(trip({ paidAt: new Date() })).rejects.toThrow(/Trip_paid_with_method/);
    await expect(
      trip({ paidAt: new Date(), paymentMethod: "CASH_TO_DRIVER" }),
    ).resolves.toBeDefined();
  });
});

describe("a trip's load", () => {
  it("fits its car body, with the limits in contracts", async () => {
    const trip = await tripSetup();
    for (const car of carBodies) {
      const capacity = carCapacity[car];
      await expect(trip({ car, ...capacity })).resolves.toBeDefined();
      for (const field of Object.keys(capacity) as (keyof typeof capacity)[]) {
        await expect(trip({ car, ...capacity, [field]: capacity[field] + 1 })).rejects.toThrow(
          /Trip_fits_car/,
        );
      }
    }
    await expect(trip({ passengers: 0 })).rejects.toThrow(/Trip_fits_car/);
    await expect(trip({ smallLuggage: -1 })).rejects.toThrow(/Trip_fits_car/);
  });
});

describe("assignment", () => {
  it("puts a driver or a vehicle on one trip in progress at most", async () => {
    const trip = await tripSetup();
    const { id: driverId } = await driver();
    await trip({ driverId, status: "IN_PROGRESS" });
    await expect(trip({ driverId, status: "CONFIRMED" })).resolves.toBeDefined();
    await expect(trip({ driverId, status: "IN_PROGRESS" })).rejects.toThrow(
      /Trip_one_in_progress_per_driver/,
    );
  });

  it("of an office's trip only uses that office's driver and vehicle", async () => {
    const trip = await tripSetup();
    const office = await prisma.office.create({
      data: { name: "Office", contact: "C", phone: "+201000000009", address: "A" },
    });
    const own = await driver({ isExternal: true, officeId: office.id });
    const freelance = await driver({ isExternal: true });
    const internal = await driver();

    await expect(trip({ officeId: office.id })).resolves.toBeDefined();
    await expect(trip({ officeId: office.id, driverId: own.id })).resolves.toBeDefined();
    await expect(trip({ officeId: office.id, driverId: freelance.id })).rejects.toThrow(
      /Trip_assignment_matches_office/,
    );
    await expect(trip({ driverId: internal.id })).resolves.toBeDefined();
  });
});

describe("trip classes", () => {
  it("keep active names unique in each language", async () => {
    await prisma.tripClass.create({ data: { nameEn: "VIP", nameAr: "كبار الشخصيات" } });
    await expect(
      prisma.tripClass.create({ data: { nameEn: "vip", nameAr: "آخر" } }),
    ).rejects.toThrow(/TripClass_active_nameEn/);
    await prisma.tripClass.updateMany({ data: { archivedAt: new Date() } });
    await expect(
      prisma.tripClass.create({ data: { nameEn: "VIP", nameAr: "كبار الشخصيات" } }),
    ).resolves.toBeDefined();
  });
});

describe("a driver's report", () => {
  const report = async () => {
    const trip = await (await tripSetup())();
    const at = (minutes: number) => new Date(Date.UTC(2026, 10, 21, 8, minutes));
    const base = {
      tripId: trip.id,
      startedAt: at(0),
      vehiclePickup: "Garage",
      startMileage: 1000,
      pickupAt: at(10),
      dropoffAt: at(50),
      vehicleDropoff: "Garage",
      endedAt: at(60),
      endMileage: 1100,
    };
    return { base, at };
  };

  it("runs in order and the odometer never goes back", async () => {
    const { base, at } = await report();
    await expect(prisma.tripReport.create({ data: { ...base, pickupAt: at(70) } })).rejects.toThrow(
      /TripReport_chronology/,
    );
    // Taking the car at the pickup minute is fine; dropping off at the pickup, or returning the car at the drop-off, isn't.
    await expect(
      prisma.tripReport.create({ data: { ...base, dropoffAt: base.pickupAt } }),
    ).rejects.toThrow(/TripReport_chronology/);
    await expect(
      prisma.tripReport.create({ data: { ...base, endedAt: base.dropoffAt } }),
    ).rejects.toThrow(/TripReport_chronology/);
    await expect(prisma.tripReport.create({ data: { ...base, endMileage: 900 } })).rejects.toThrow(
      /TripReport_mileage/,
    );
    await expect(
      prisma.tripReport.create({ data: { ...base, startedAt: base.pickupAt } }),
    ).resolves.toBeDefined();
  });

  it("has stops that are an address or a pin, never both", async () => {
    const { base, at } = await report();
    const { id: reportId } = await prisma.tripReport.create({ data: base });
    const stop = { reportId, startedAt: at(20), endedAt: at(25) };

    await expect(
      prisma.tripStop.create({ data: { ...stop, address: "Mall" } }),
    ).resolves.toBeDefined();
    await expect(
      prisma.tripStop.create({ data: { ...stop, latitude: "30.1", longitude: "31.2" } }),
    ).resolves.toBeDefined();
    await expect(prisma.tripStop.create({ data: stop })).rejects.toThrow(/TripStop_address_or_pin/);
    await expect(
      prisma.tripStop.create({
        data: { ...stop, address: "Mall", latitude: "30.1", longitude: "31.2" },
      }),
    ).rejects.toThrow(/TripStop_address_or_pin/);
    await expect(prisma.tripStop.create({ data: { ...stop, latitude: "30.1" } })).rejects.toThrow(
      /TripStop_address_or_pin/,
    );
    await expect(
      prisma.tripStop.create({ data: { ...stop, address: "Mall", endedAt: at(10) } }),
    ).rejects.toThrow(/TripStop_times/);
  });
});

describe("prices", () => {
  it("are positive", async () => {
    const cairo = await governorate();
    const tripClass = await prisma.tripClass.create({
      data: { nameEn: "Economy", nameAr: "اقتصادي" },
    });
    const row = { fromId: cairo.id, toId: cairo.id, classId: tripClass.id, car: "SEDAN" as const };
    await expect(prisma.pricing.create({ data: { ...row, price: "-1" } })).rejects.toThrow(
      /Pricing_price_positive/,
    );
    await expect(
      prisma.pricing.create({ data: { ...row, price: "250.00" } }),
    ).resolves.toBeDefined();
  });
});

describe("whole numbers", () => {
  it("are never negative", async () => {
    await expect(
      prisma.tripClass.create({ data: { nameEn: "Economy", nameAr: "اقتصادي", sortOrder: -1 } }),
    ).rejects.toThrow(/TripClass_sortOrder_range/);
    await expect(
      prisma.tripClass.create({ data: { nameEn: "Economy", nameAr: "اقتصادي", sortOrder: 0 } }),
    ).resolves.toBeDefined();

    const vehicle = {
      make: "Toyota",
      model: "Corolla",
      plateNumber: "ABC 123",
      color: "White",
      body: "SEDAN" as const,
    };
    await expect(prisma.vehicle.create({ data: { ...vehicle, year: -2020 } })).rejects.toThrow(
      /Vehicle_year_range/,
    );
    await expect(
      prisma.vehicle.create({ data: { ...vehicle, year: 2020 } }),
    ).resolves.toBeDefined();

    await expect(
      prisma.customer.create({
        data: {
          firstName: "Mona",
          lastName: "Adel",
          phone: "+201000000001",
          email: "mona@terhal.co",
          passwordHash: "x",
          verificationAttempts: -1,
        },
      }),
    ).rejects.toThrow(/Customer_verificationAttempts_nonnegative/);
  });
});
