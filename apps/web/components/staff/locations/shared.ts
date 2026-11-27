import { toLatinDigits } from "@/lib/digits";

export const locationsKey = ["staff", "locations"] as const;

// A coordinate or a radius typed in the form: Arabic digits accepted, blank or junk is null.
export const parseNumber = (value: string) => {
  const text = toLatinDigits(value).trim();
  if (text === "" || !/^-?\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
};

// The form takes the radius in kilometres; the API keeps meters.
export const toMeters = (km: number) => Math.round(km * 1000);
export const toKm = (meters: number) => String(Math.round(meters / 100) / 10);

export const mapLink = (latitude: number, longitude: number) =>
  `https://www.openstreetmap.org/?mlat=${String(latitude)}&mlon=${String(longitude)}#map=13/${String(latitude)}/${String(longitude)}`;
