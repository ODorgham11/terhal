import type { CarBody } from "@terhal/contracts";
import { describe, expect, it } from "vitest";
import { toCsv } from "../../../src/modules/pricing/domain/csv";
import { entryKey, entryProblems } from "../../../src/modules/pricing/domain/entries";
import { pickPrices, walkOrder } from "../../../src/modules/pricing/domain/walk";

// Degla (area) in Maadi (district) in Cairo; Dokki (district) in Giza; the airport (area) directly in Cairo.
const degla = [
  { id: "degla", locality: "AREA" as const },
  { id: "maadi", locality: "DISTRICT" as const },
  { id: "cairo", locality: "GOVERNORATE" as const },
];
const dokki = [
  { id: "dokki", locality: "DISTRICT" as const },
  { id: "giza", locality: "GOVERNORATE" as const },
];

describe("the pricing walk", () => {
  it("tries pairs from most to least specific, the more specific pickup first on a tie", () => {
    expect(walkOrder(degla, dokki).map(({ fromId, toId }) => `${fromId}>${toId}`)).toEqual([
      "degla>dokki",
      "degla>giza",
      "maadi>dokki",
      "maadi>giza",
      "cairo>dokki",
      "cairo>giza",
    ]);
  });

  it("ranks by locality, not by steps up the tree", () => {
    const airport = [
      { id: "airport", locality: "AREA" as const },
      { id: "cairo", locality: "GOVERNORATE" as const },
    ];
    expect(walkOrder(dokki, airport).map(({ fromId, toId }) => `${fromId}>${toId}`)).toEqual([
      "dokki>airport",
      "giza>airport",
      "dokki>cairo",
      "giza>cairo",
    ]);
  });

  it("picks each class and body's price from the earliest pair with a row", () => {
    const order = walkOrder(degla, dokki);
    const row = (fromId: string, toId: string, price: string, car: CarBody = "SEDAN") => ({
      fromId,
      toId,
      classId: "economy",
      car,
      price,
    });
    const prices = pickPrices(
      [
        row("cairo", "giza", "100.00"),
        row("maadi", "dokki", "90.00"),
        row("degla", "giza", "95.00"),
        row("cairo", "giza", "300.00", "VAN"),
        row("giza", "cairo", "1.00"),
      ],
      order,
    );
    expect(Object.fromEntries(prices)).toEqual({
      "economy:SEDAN": "95.00",
      "economy:VAN": "300.00",
    });
  });
});

describe("price entries", () => {
  const known = {
    places: new Map([
      ["degla", { locality: "AREA" as const, deleted: false }],
      ["cairo", { locality: "GOVERNORATE" as const, deleted: false }],
      ["old", { locality: "AREA" as const, deleted: true }],
    ]),
    classes: new Map([
      ["economy", { archived: false }],
      ["retired", { archived: true }],
    ]),
  };
  const entry = { fromId: "cairo", toId: "cairo", classId: "economy", car: "SEDAN" as const };

  it("allow a governorate or a district to itself, never an area", () => {
    expect(entryProblems(entry, known)).toEqual([]);
    expect(entryProblems({ ...entry, fromId: "degla", toId: "degla" }, known)).toEqual([
      { field: "toId", message: "An area can't be priced to itself." },
    ]);
  });

  it("need live places and an active class", () => {
    expect(
      entryProblems({ ...entry, fromId: "old", toId: "nope", classId: "retired" }, known).map(
        (problem) => problem.field,
      ),
    ).toEqual(["fromId", "toId", "classId"]);
  });

  it("are keyed by route, class and body", () => {
    expect(entryKey(entry)).toBe("cairo>cairo:economy:SEDAN");
  });
});

describe("CSV", () => {
  it("quotes what needs quoting and defuses formulas", () => {
    expect(
      toCsv(
        ["a", "b"],
        [
          ["x,y", '"q"'],
          ["=1+1", "-2"],
        ],
      ),
    ).toBe('﻿a,b\r\n"x,y","""q"""\r\n\'=1+1,\'-2\r\n');
  });
});
