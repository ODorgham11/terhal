import { z } from "zod";

// Car bodies are fixed in code, smallest first. The order is what "larger" means when a trip is given a bigger vehicle
// than it was booked for (an upgrade); a smaller one is never allowed.
export const carBodies = ["SEDAN", "SUV", "MINIVAN", "VAN"] as const;
export const CarBody = z.enum(carBodies).meta({ id: "CarBody" });
export type CarBody = z.infer<typeof CarBody>;

// Whether a vehicle with this body can serve a trip booked for that one: the same size or larger.
export const canServe = (vehicle: CarBody, booked: CarBody) =>
  carBodies.indexOf(vehicle) >= carBodies.indexOf(booked);

export interface CarCapacity {
  passengers: number;
  largeLuggage: number;
  mediumLuggage: number;
  smallLuggage: number;
}

// What fits in each body. The database holds the same limits (the Trip_fits_car check, trips migration); a server test
// keeps the two in step.
// PLACEHOLDER numbers: the client hasn't given the real ones yet. Change both places together.
export const carCapacity: Record<CarBody, CarCapacity> = {
  SEDAN: { passengers: 4, largeLuggage: 2, mediumLuggage: 1, smallLuggage: 2 },
  SUV: { passengers: 6, largeLuggage: 3, mediumLuggage: 2, smallLuggage: 3 },
  MINIVAN: { passengers: 7, largeLuggage: 4, mediumLuggage: 3, smallLuggage: 4 },
  VAN: { passengers: 14, largeLuggage: 8, mediumLuggage: 6, smallLuggage: 8 },
};

export const fitsCar = (car: CarBody, load: CarCapacity) => {
  const capacity = carCapacity[car];
  return (
    load.passengers >= 1 &&
    load.passengers <= capacity.passengers &&
    load.largeLuggage >= 0 &&
    load.largeLuggage <= capacity.largeLuggage &&
    load.mediumLuggage >= 0 &&
    load.mediumLuggage <= capacity.mediumLuggage &&
    load.smallLuggage >= 0 &&
    load.smallLuggage <= capacity.smallLuggage
  );
};
