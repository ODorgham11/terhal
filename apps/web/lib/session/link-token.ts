"use client";

import { useSyncExternalStore } from "react";

// The ?token= of an emailed link, read in the browser (undefined while rendering on the server, null when missing).
// Read this way rather than with useSearchParams, which would need a Suspense boundary.
export function useLinkToken() {
  return useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get("token"),
    () => undefined,
  );
}
