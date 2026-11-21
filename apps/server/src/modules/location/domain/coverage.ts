import { MAX_RADIUS, type Pin } from "@terhal/contracts";

// A little under the true 111.2 km, so the box errs wide.
const METERS_PER_DEGREE_LATITUDE = 111_000;

// The latitude and longitude ranges any circle that could contain `pin` has its center in, so the coverage query only
// measures distances to nearby centers. Generous on purpose: it's a prefilter, the haversine distance decides.
export const boundingBox = ({ latitude, longitude }: Pin, radius = MAX_RADIUS) => {
  const latitudeSpan = radius / METERS_PER_DEGREE_LATITUDE;
  const longitudeSpan = latitudeSpan / Math.max(Math.cos((latitude * Math.PI) / 180), 0.01);
  return {
    minLatitude: latitude - latitudeSpan,
    maxLatitude: latitude + latitudeSpan,
    minLongitude: longitude - longitudeSpan,
    maxLongitude: longitude + longitudeSpan,
  };
};

const EARTH_RADIUS = 6_371_008.8;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

// Great-circle distance in meters. The coverage query computes the same in SQL; this is for tests and the seed.
export const haversine = (a: Pin, b: Pin) => {
  const h =
    Math.sin(radians(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(radians(b.longitude - a.longitude) / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
};
