import { BULK_PRICING_LIMIT, carBodies, type CarBody, type PricingEntry } from "@terhal/contracts";

// Splits CSV text into rows of cells: quoted cells may hold commas, newlines and doubled quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}

export type ImportPlan = {
  entries: PricingEntry[];
  // 1-based line numbers of rows that can't be sent.
  skipped: number[];
  missingColumns: string[];
};

const REQUIRED = ["fromId", "toId", "classId", "car", "price"] as const;

// The price list export's id, car and price columns, as the bulk upload takes them. Other columns are ignored, so an
// edited export can be sent back as it is.
export function planImport(text: string): ImportPlan {
  const [header = [], ...lines] = parseCsv(text.replace(/^﻿/, ""));
  const columns = header.map((name) => name.trim());
  const missingColumns = REQUIRED.filter((name) => !columns.includes(name));
  if (missingColumns.length > 0) return { entries: [], skipped: [], missingColumns };

  const at = (cells: string[], name: string) => (cells[columns.indexOf(name)] ?? "").trim();
  const entries: PricingEntry[] = [];
  const skipped: number[] = [];
  lines.forEach((cells, index) => {
    const car = at(cells, "car").toUpperCase();
    const price = at(cells, "price").replace(/,/g, "");
    const entry = {
      fromId: at(cells, "fromId"),
      toId: at(cells, "toId"),
      classId: at(cells, "classId"),
      car,
      price,
    };
    if (
      !entry.fromId ||
      !entry.toId ||
      !entry.classId ||
      !(carBodies as readonly string[]).includes(car) ||
      !/^\d{1,7}(\.\d{1,2})?$/.test(price) ||
      Number(price) <= 0
    ) {
      skipped.push(index + 2);
      return;
    }
    entries.push({ ...entry, car: car as CarBody, price: Number(price).toFixed(2) });
  });
  return { entries, skipped, missingColumns };
}

export const chunks = <T>(items: T[], size = BULK_PRICING_LIMIT) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
