// Request and response schemas shared by the API and the web app. Framework-free (plain zod with .meta()), so the web
// app can use them without Hono. Exported as TypeScript: the server bundles it (tsup) and Next transpiles it.
export * from "./admin";
export * from "./audit";
export * from "./cars";
export * from "./customer";
export * from "./errors";
export * from "./fields";
export * from "./lists";
export * from "./locale";
export * from "./locations";
export * from "./permissions";
export * from "./pricing";
export * from "./problem";
export * from "./quotes";
export * from "./search";
export * from "./staff";
export * from "./trip-classes";
export * from "./trip-events";
