// Analytics: the dashboard's figures, the CSV exports and the monthly XLSX report, kept in storage and listed as
// AnalyticsDocument rows. Read only over the other modules' tables; it writes nothing but its own documents.
export {
  hasMonthReport,
  MONTHLY_REPORT_JOB,
  processAnalyticsJob,
  scheduleAnalyticsJobs,
} from "./application/reports";
export { analyticsRoutes } from "./http/routes";
