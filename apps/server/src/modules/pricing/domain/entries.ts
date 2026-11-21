import type { CarBody, Locality } from "@terhal/contracts";

// What a new or uploaded price must point at: live places and an active class. A route's ends may be the same place,
// except an area (P3, answered: a trip within one area isn't bookable, so its price would never be used).

export interface EntryRefs {
  fromId: string;
  toId: string;
  classId: string;
  car: CarBody;
}

export interface Known {
  places: ReadonlyMap<string, { locality: Locality; deleted: boolean }>;
  classes: ReadonlyMap<string, { archived: boolean }>;
}

export interface EntryProblem {
  field: "fromId" | "toId" | "classId";
  message: string;
}

export const entryProblems = ({ fromId, toId, classId }: EntryRefs, known: Known) => {
  const problems: EntryProblem[] = [];
  for (const field of ["fromId", "toId"] as const) {
    const place = known.places.get(field === "fromId" ? fromId : toId);
    if (!place) problems.push({ field, message: "There's no location with this id." });
    else if (place.deleted) problems.push({ field, message: "This location is deleted." });
  }
  const tripClass = known.classes.get(classId);
  if (!tripClass) {
    problems.push({ field: "classId", message: "There's no trip class with this id." });
  } else if (tripClass.archived) {
    problems.push({ field: "classId", message: "This trip class is archived." });
  }
  if (fromId === toId && known.places.get(fromId)?.locality === "AREA") {
    problems.push({ field: "toId", message: "An area can't be priced to itself." });
  }
  return problems;
};

// The unique key of a price row (Pricing_fromId_toId_classId_car_key).
export const entryKey = ({ fromId, toId, classId, car }: EntryRefs) =>
  `${fromId}>${toId}:${classId}:${car}`;
