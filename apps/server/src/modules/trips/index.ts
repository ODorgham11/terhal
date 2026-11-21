// Trips: booking on the site and in the dashboard, the status lifecycle, price on request, assignment, linked return
// trips and the jobs that move trips on. Every change to a trip goes through changeTrip, which records its TripEvent;
// application/hooks.ts is where notifications, the driver report and the driver ledger plug in.
export {
  changeTrip,
  recordTripEvent,
  type RecordedTripEvent,
  type SystemJob,
  type TripActor,
  type TripChange,
  type TripEventInput,
} from "./application/events";
export { processTripJob, tripJobs } from "./application/jobs";
export {
  customerTripTotals,
  customerTrips,
  driverTrips,
  liveOfficeTrips,
} from "./application/queries";
export { siteTripRoutes } from "./http/site-routes";
export { staffTripRoutes } from "./http/staff-routes";
