import type { CarBody, Locality } from "@terhal/contracts";

// How a quote finds a price (P1 b): try every pair of (a place the pickup is in, a place the drop-off is in) from the
// most specific to the least, and take the first pair with a row for the class and car body.

// How narrow a locality is: an area is narrower than a district, which is narrower than a governorate.
const specificity: Record<Locality, number> = { GOVERNORATE: 0, DISTRICT: 1, AREA: 2 };

export interface Place {
  id: string;
  locality: Locality;
}

// Every (from, to) pair to try, most specific first. A pair's specificity is the sum of its ends'; at equal sums the more
// specific pickup wins. Chains run from the resolved place itself up to its governorate. Each end's localities are
// distinct, so no two pairs tie.
export const walkOrder = (pickup: readonly Place[], dropoff: readonly Place[]) =>
  pickup
    .flatMap((from) => dropoff.map((to) => ({ from, to })))
    .sort(
      (a, b) =>
        specificity[b.from.locality] +
          specificity[b.to.locality] -
          (specificity[a.from.locality] + specificity[a.to.locality]) ||
        specificity[b.from.locality] - specificity[a.from.locality],
    )
    .map(({ from, to }) => ({ fromId: from.id, toId: to.id }));

export interface PriceRow {
  fromId: string;
  toId: string;
  classId: string;
  car: CarBody;
  price: string;
}

export const optionKey = (classId: string, car: CarBody) => `${classId}:${car}`;

// The price for each class and body: the row of the earliest pair in the walk. Rows for pairs outside the walk are
// ignored.
export const pickPrices = (
  rows: readonly PriceRow[],
  order: readonly { fromId: string; toId: string }[],
) => {
  const rank = new Map(order.map(({ fromId, toId }, index) => [`${fromId}>${toId}`, index]));
  const best = new Map<string, { rank: number; price: string }>();
  for (const row of rows) {
    const index = rank.get(`${row.fromId}>${row.toId}`);
    if (index === undefined) continue;
    const key = optionKey(row.classId, row.car);
    const current = best.get(key);
    if (!current || index < current.rank) best.set(key, { rank: index, price: row.price });
  }
  return new Map([...best].map(([key, { price }]) => [key, price]));
};
