// Drivers (with their ledger), vehicles (with their images) and the outside offices they can come through, as the staff
// dashboard manages them.
export { driverRoutes } from "./http/driver-routes";
export { officeRoutes } from "./http/office-routes";
export { vehicleRoutes } from "./http/vehicle-routes";
export {
  appendTripLedger,
  tripLedgerBalances,
  type TripLedgerEntry,
} from "./application/ledger";
export {
  assignableFleet,
  lockAssignees,
  type Assignees,
  type LockedAssignees,
} from "./application/assignees";
