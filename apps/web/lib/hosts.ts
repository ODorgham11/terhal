// The three hosts the app serves, named after their folders under app/. admin.terhal.co is the admin panel,
// dashboard.terhal.co the staff dashboard, and everything else (terhal.co) the customer site. Staging
// (*.staging.terhal.co) and local development (*.local.terhal.co) follow the same prefixes.
export type Section = "admin" | "staff" | "site";

export const sectionOf = (host: string | null | undefined): Section => {
  if (host?.startsWith("admin.")) return "admin";
  if (host?.startsWith("dashboard.")) return "staff";
  return "site";
};
