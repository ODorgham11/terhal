// Notifications (N1-N6): emails to a trip's booker and the staff dashboard's inbox, from every trip event. Written in
// the event's transaction through notifyTripEvent (the trips module's afterTripEvent hook), sent by the worker from the
// outbox, with reminders as delayed jobs.
export { notifyTripEvent, type TripEventNotice } from "./application/notify";
export { notificationJobs, processNotificationJob } from "./application/jobs";
export { staffNotificationRoutes } from "./http/routes";
