import { z } from "zod";

// Every action a TripEvent can record. Kept in one place, like the audit log's, so a trip's history stays readable by a
// fixed set of names. An event's `data` carries the details (the statuses moved between, a reason, changed fields).
export const tripEventActions = {
  CREATED: "trip.created",
  UPDATED: "trip.updated",

  // Price on request: staff propose a price, the booker accepts or declines it.
  PRICE_PROPOSED: "trip.price_proposed",
  PRICE_ACCEPTED: "trip.price_accepted",
  PRICE_DECLINED: "trip.price_declined",

  CONFIRMED: "trip.confirmed",
  ASSIGNED: "trip.assigned",
  UNASSIGNED: "trip.unassigned",
  STARTED: "trip.started",
  // Staff undoing a start made by mistake (back to confirmed).
  START_UNDONE: "trip.start_undone",
  ENDED: "trip.ended",
  COMPLETED: "trip.completed",
  // Staff reopening a completed trip's report (back to awaiting report).
  REOPENED: "trip.reopened",
  CANCELLED: "trip.cancelled",

  REPORT_LINK_ISSUED: "trip.report_link_issued",
  REPORT_SUBMITTED: "trip.report_submitted",
  REPORT_EDITED: "trip.report_edited",

  PAYMENT_RECORDED: "trip.payment_recorded",

  // A return trip linked to or unlinked from this one.
  LINKED: "trip.linked",
  UNLINKED: "trip.unlinked",
} as const;

export type TripEventAction = (typeof tripEventActions)[keyof typeof tripEventActions];

export const TripEventAction = z
  .enum(Object.values(tripEventActions) as [TripEventAction, ...TripEventAction[]])
  .meta({ id: "TripEventAction" });
