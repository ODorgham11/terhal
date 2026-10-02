import { hc } from "hono/client";
import type { AppType } from "./app.js";

// The type of the RPC client for the whole app, computed here so it resolves against the backend's own copy of hono.
// The frontend imports only this type (never the app itself), since its own copy of hono can't type check our routes.
export type Client = ReturnType<typeof hc<AppType>>;
export type { ErrorCode } from "./shared/utils/error.js";
