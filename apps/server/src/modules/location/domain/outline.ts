import type { Boundary } from "@terhal/contracts";

// A governorate's outline: Postgres's `polygon` type, (longitude, latitude) points, implicitly closed. The API shows it
// as a GeoJSON polygon, whose ring repeats its first point at the end.

export type Point = readonly [longitude: number, latitude: number];

// "((31.2,30.1),(31.3,30.1),...)", as Postgres prints a polygon, into its points.
export const parsePolygon = (text: string): Point[] =>
  [...text.matchAll(/\(\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*\)/g)].map(
    ([, x = "", y = ""]) => [Number(x), Number(y)] as const,
  );

export const polygonText = (points: readonly Point[]) =>
  `(${points.map(([x, y]) => `(${x},${y})`).join(",")})`;

export const toGeoJson = (points: readonly Point[]): Boundary => {
  const ring = points.map(([x, y]) => [x, y] as [number, number]);
  const first = points[0];
  if (first && !same(first, points.at(-1))) ring.push([first[0], first[1]]);
  return { type: "Polygon", coordinates: [ring] };
};

// The point at `index`, which the caller knows is in range.
const pointAt = (points: readonly Point[], index: number): Point => {
  const point = points[index];
  if (!point) throw new RangeError(`No point at ${String(index)}.`);
  return point;
};

const same = (a: Point | undefined, b: Point | undefined) =>
  a !== undefined && a[0] === b?.[0] && a[1] === b[1];

// Twice the signed area of a ring (shoelace), in square degrees. Only compared between rings.
export const ringArea = (ring: readonly Point[]) => {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = pointAt(ring, i);
    const [x2, y2] = pointAt(ring, (i + 1) % ring.length);
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
};

export type Geometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

// The outer ring of a polygon, or of a multipolygon's largest part: the column holds one ring, so islands and enclaves
// (the Red Sea's islands, say) are dropped. Holes are ignored.
export const outerRing = (geometry: Geometry): Point[] => {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let best: Point[] = [];
  for (const [outer = []] of polygons) {
    const ring = outer.map(([x = 0, y = 0]) => [x, y] as const);
    if (ringArea(ring) > ringArea(best)) best = ring;
  }
  return best;
};

const distanceToSegment = ([px, py]: Point, [ax, ay]: Point, [bx, by]: Point) => {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

// Douglas–Peucker on an open polyline: keeps the ends, and every point further than `tolerance` (degrees) from the line
// between the points kept around it.
const douglasPeucker = (points: readonly Point[], tolerance: number): Point[] => {
  if (points.length < 3) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop() ?? [0, 0];
    let furthest = -1;
    let distance = tolerance;
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(pointAt(points, i), pointAt(points, start), pointAt(points, end));
      if (d > distance) {
        furthest = i;
        distance = d;
      }
    }
    if (furthest !== -1) {
      keep[furthest] = true;
      stack.push([start, furthest], [furthest, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
};

const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

// Rounds every coordinate, drops points that became repeats, and drops a closing point equal to the first.
const roundRing = (ring: readonly Point[], decimals: number) => {
  const rounded: Point[] = [];
  for (const [x, y] of ring) {
    const point = [round(x, decimals), round(y, decimals)] as const;
    if (!same(rounded.at(-1), point)) rounded.push(point);
  }
  if (rounded.length > 1 && same(rounded[0], rounded.at(-1))) rounded.pop();
  return rounded;
};

// An outline small enough to serve to every visitor (the L8 assessment): Douglas–Peucker from `tolerance` degrees
// (0.001° is about 100 m), doubled until at most `maxPoints` remain, then rounded to `decimals` places (5 is about 1 m).
// The ring is split at its first point and the point furthest from it, so the shape's ends survive simplification.
export const simplifyRing = (
  ring: readonly Point[],
  { tolerance = 0.001, maxPoints = 300, decimals = 5 } = {},
): Point[] => {
  const open = roundRing(ring, 10);
  if (open.length < 4) return roundRing(open, decimals);

  const start = pointAt(open, 0);
  let split = 1;
  for (let i = 1; i < open.length; i++) {
    const [x, y] = pointAt(open, i);
    const [sx, sy] = pointAt(open, split);
    if (Math.hypot(x - start[0], y - start[1]) > Math.hypot(sx - start[0], sy - start[1]))
      split = i;
  }

  for (let current = tolerance; ; current *= 2) {
    const first = douglasPeucker(open.slice(0, split + 1), current);
    const second = douglasPeucker([...open.slice(split), start], current);
    const simplified = roundRing([...first, ...second.slice(1)], decimals);
    if (simplified.length <= maxPoints || simplified.length <= 4) return simplified;
  }
};
