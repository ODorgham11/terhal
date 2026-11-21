import { z } from "zod";

// What a staff member may do in the dashboard. Stored on Staff.permissions as a list of these; the API checks them on
// every request, the dashboard only uses them to hide what can't be used.
export const staffPermissions = [
  // See and run trips: create, confirm, cancel, assign drivers and vehicles, review reports.
  "trips",
  // Drivers, vehicles and offices.
  "fleet",
  // Trip classes and the price list.
  "pricing",
  "customers",
  // Invite staff, change their permissions, suspend them.
  "team",
  "analytics",
] as const;

export const StaffPermission = z.enum(staffPermissions).meta({ id: "StaffPermission" });
export type StaffPermission = z.infer<typeof StaffPermission>;

export const StaffPermissions = z
  .array(StaffPermission)
  .transform((permissions) => [...new Set(permissions)])
  .meta({ id: "StaffPermissions" });
