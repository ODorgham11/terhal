import { z } from "zod";

// Places the platform serves: a tree of governorates, districts and areas, each with a coverage shape. See
// docs/decisions.md, "Coverage without PostGIS", and docs/domains.md, section L.

// Broadest first. A district sits in a governorate; an area in a district or directly in a governorate.
export const localities = ["GOVERNORATE", "DISTRICT", "AREA"] as const;
export const Locality = z.enum(localities).meta({ id: "Locality" });
export type Locality = z.infer<typeof Locality>;

// A district's or an area's radius when none is given, and the largest allowed, in meters.
export const DEFAULT_RADIUS = 10_000;
export const MAX_RADIUS = 100_000;

export const Latitude = z
  .number({ error: "Latitude must be a number." })
  .min(-90, "Latitude must be between -90 and 90.")
  .max(90, "Latitude must be between -90 and 90.");

export const Longitude = z
  .number({ error: "Longitude must be a number." })
  .min(-180, "Longitude must be between -180 and 180.")
  .max(180, "Longitude must be between -180 and 180.");

// A point on the map, e.g. a pickup.
export const Pin = z
  .object({ latitude: Latitude, longitude: Longitude })
  .meta({ id: "Pin", example: { latitude: 29.9602, longitude: 31.2569 } });
export type Pin = z.infer<typeof Pin>;

const Radius = z
  .number({ error: "Radius must be a number." })
  .int("Radius must be a whole number of meters.")
  .min(100, "Radius must be at least 100 meters.")
  .max(MAX_RADIUS, "Radius must be 100 km at most.");

// A district's or an area's coverage: everything within `radius` meters of the center.
export const Center = z
  .object({
    latitude: Latitude,
    longitude: Longitude,
    radius: Radius.default(DEFAULT_RADIUS).meta({ description: "In meters. Defaults to 10 km." }),
  })
  .meta({ id: "LocationCenter" });
export type Center = z.output<typeof Center>;

// A governorate's coverage, as a GeoJSON polygon: one closed ring of [longitude, latitude] points, without holes. Read
// only: outlines come from the governorate seed, never from the API.
export const Boundary = z
  .object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
  })
  .meta({
    id: "LocationBoundary",
    description: "GeoJSON: one ring of [longitude, latitude] points.",
  });
export type Boundary = z.infer<typeof Boundary>;

const LocationName = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(2, `${label} must contain at least 2 letters.`)
    .max(80, `${label} must contain 80 letters at most.`);

const Id = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(100, `${label} must contain 100 characters at most.`);

// Enough to name a place: in lists of ancestors, on prices and on quotes.
export const LocationSummary = z
  .object({ id: z.string(), locality: Locality, nameEn: z.string(), nameAr: z.string() })
  .meta({ id: "LocationSummary" });
export type LocationSummary = z.infer<typeof LocationSummary>;

export const Location = z
  .object({
    id: z.string(),
    parentId: z.string().nullable(),
    locality: Locality,
    nameEn: z.string(),
    nameAr: z.string(),
    center: Center.nullable().meta({
      description: "A district's or an area's; null for a governorate.",
    }),
    hasBoundary: z.boolean().meta({ description: "Whether a governorate has its outline." }),
    deletedAt: z.iso.datetime().nullable(),
    deletedWithId: z.string().nullable().meta({
      description:
        "The location whose delete removed this one. Only a location deleted with itself can be restored; restoring it brings back everything deleted with it.",
    }),
  })
  .meta({ id: "Location" });
export type Location = z.infer<typeof Location>;

// One location with what the admin panel and the dashboard show before changing it.
export const LocationDetail = Location.extend({
  boundary: Boundary.nullable(),
  ancestors: z
    .array(LocationSummary)
    .meta({ description: "From the governorate down to the parent." }),
  subtreeSize: z.int().meta({
    description:
      "Live locations a delete would remove: this one and its live descendants. Send it back as `expectedCount`.",
  }),
  usage: z.object({
    pricing: z.int().meta({ description: "Price rows from or to it." }),
    offices: z.int(),
    upcomingTrips: z
      .int()
      .meta({ description: "Pending or confirmed trips picking up or dropping off here." }),
  }),
}).meta({ id: "LocationDetail" });
export type LocationDetail = z.infer<typeof LocationDetail>;

const flag = (label: string) =>
  z
    .enum(["true", "false"], { error: `${label} must be true or false.` })
    .transform((value) => value === "true");

export const ListLocations = z.object({
  parentId: Id("Parent").optional(),
  locality: Locality.optional(),
  q: z.string().trim().max(100, "Search must contain 100 characters at most.").optional(),
  deleted: flag("Deleted")
    .default(false)
    .meta({ description: "true lists only deleted locations." }),
  limit: z.coerce
    .number({ error: "Limit must be a number." })
    .int("Limit must be a whole number.")
    .min(1, "Limit must be at least 1.")
    .max(200, "Limit must be 200 at most.")
    .default(50),
  // The id of the last location on the current page. The next page starts right after it.
  cursor: Id("Cursor").optional(),
});
export type ListLocations = z.output<typeof ListLocations>;

// Governorates come from the seed, so only districts and areas are created through the API.
export const CreateLocation = z
  .object({
    locality: z.enum(["DISTRICT", "AREA"], { error: "Locality must be DISTRICT or AREA." }),
    parentId: Id("Parent"),
    nameEn: LocationName("English name"),
    nameAr: LocationName("Arabic name"),
    center: Center,
  })
  .meta({ id: "CreateLocation" });
export type CreateLocation = z.output<typeof CreateLocation>;

// Send only what changes. A governorate only takes names. Locality never changes: it decides the shape.
export const UpdateLocation = z
  .object({
    parentId: Id("Parent")
      .optional()
      .meta({ description: "Moves the location, children included." }),
    nameEn: LocationName("English name").optional(),
    nameAr: LocationName("Arabic name").optional(),
    center: z
      .object({ latitude: Latitude, longitude: Longitude, radius: Radius.optional() })
      .optional()
      .meta({ description: "The radius stays as it is unless given." }),
  })
  .refine((update) => Object.keys(update).length > 0, {
    message: "Send at least one field to change.",
  })
  .meta({ id: "UpdateLocation" });
export type UpdateLocation = z.output<typeof UpdateLocation>;

export const DeleteLocation = z.object({
  expectedCount: z.coerce
    .number({ error: "Expected count must be a number." })
    .int("Expected count must be a whole number.")
    .min(1, "Expected count must be at least 1.")
    .meta({
      description:
        "How many live locations the delete removes: this one and its live descendants (`subtreeSize` on the detail).",
    }),
});

export const LocationDeleted = z
  .object({ count: z.int().meta({ description: "Locations deleted, this one included." }) })
  .meta({ id: "LocationDeleted" });

export const LocationRestored = z
  .object({ count: z.int().meta({ description: "Locations restored, this one included." }) })
  .meta({ id: "LocationRestored" });

export const CoverageQuery = z.object({
  latitude: z.coerce.number({ error: "Latitude must be a number." }).pipe(Latitude),
  longitude: z.coerce.number({ error: "Longitude must be a number." }).pipe(Longitude),
});

// A location with the places it sits in, e.g. Maadi in Cairo.
export const ResolvedLocation = LocationSummary.extend({
  ancestors: z
    .array(LocationSummary)
    .meta({ description: "From the governorate down to the parent." }),
}).meta({ id: "ResolvedLocation" });
export type ResolvedLocation = z.infer<typeof ResolvedLocation>;

export const Coverage = z
  .object({
    covered: z.boolean(),
    location: ResolvedLocation.nullable().meta({
      description:
        "The most specific location covering the point (an area before a district before a governorate, then the nearest center), or null when it isn't covered.",
    }),
  })
  .meta({ id: "Coverage" });
export type Coverage = z.infer<typeof Coverage>;

// The customer site's copy of the live tree, so the map can show coverage and search can run in the browser.
export const SiteLocation = z
  .object({
    id: z.string(),
    parentId: z.string().nullable(),
    locality: Locality,
    nameEn: z.string(),
    nameAr: z.string(),
    center: Center.nullable(),
  })
  .meta({ id: "SiteLocation" });

export const SiteLocations = z
  .object({
    data: z.array(SiteLocation),
    outlinesVersion: z.string().meta({
      description: "Pass it as `v` to /v1/site/locations/outlines, which is then cached for good.",
    }),
  })
  .meta({ id: "SiteLocations" });
export type SiteLocations = z.infer<typeof SiteLocations>;

export const SiteLocationOutlinesQuery = z.object({
  v: z
    .string()
    .trim()
    .max(100)
    .optional()
    .meta({ description: "`outlinesVersion` from /v1/site/locations." }),
});

export const SiteLocationOutlines = z
  .object({
    data: z.array(z.object({ id: z.string(), boundary: Boundary })),
    attribution: z
      .string()
      .meta({ description: "Show it with the map: the outlines' source and licence." }),
  })
  .meta({ id: "SiteLocationOutlines" });
export type SiteLocationOutlines = z.infer<typeof SiteLocationOutlines>;
