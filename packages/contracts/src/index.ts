// Request and response schemas shared by the API and the web app. Framework-free (plain zod with .meta()), so the web
// app can use them without Hono. Exported as TypeScript: the server bundles it (tsup) and Next transpiles it.
export * from "./admin";
export * from "./audit";
export * from "./errors";
export * from "./lists";
export * from "./problem";
