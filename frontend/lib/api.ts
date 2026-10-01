import { hc } from "hono/client";
import type { Client, ErrorCode } from "@backend/client";

const endpoint = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

// The shape the backend's error handler sends back for every failed request.
export type ApiError = {
    success: false;
    error: {
        code?: ErrorCode;
        message: string;
        fields?: { field: string; message: string }[];
    };
};

// Shared between concurrent requests, so a burst of expired requests only triggers one refresh.
let refreshing: Promise<boolean> | null = null;

const refresh = () => {
    refreshing ??= fetch(`${endpoint}/auth/refresh`, { method: "POST", credentials: "include" })
        .then((response) => response.ok)
        .catch(() => false)
        .finally(() => { refreshing = null; });

    return refreshing;
};

// Tokens live in http-only cookies, so every request includes credentials.
// When the access token has expired, refresh it once and replay the request.
const appFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, { ...init, credentials: "include" });
    if (response.status !== 401) return response;

    const body: Partial<ApiError> | null = await response.clone().json().catch(() => null);
    if (body?.error?.code !== "ACCESS_TOKEN_EXPIRED") return response;
    if (!(await refresh())) return response;

    return fetch(input, { ...init, credentials: "include" });
};

// Typed against the backend's routes, e.g. api.auth["sign-in"].$post({ json: { identifier, password } }).
export const api = hc(endpoint, { fetch: appFetch }) as unknown as Client;
