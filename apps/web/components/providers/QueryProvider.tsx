"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isApiError } from "@/lib/api";

// A 4xx won't change on a retry (wrong input, no permission, signed out, rate limited), so only failures that might pass
// on a second try are retried, once: the network and a 5xx. An expired token never gets here: lib/api refreshes it.
const shouldRetry = (failureCount: number, error: unknown) => {
  if (failureCount >= 1) return false;
  if (!isApiError(error)) return false;
  return error.code === "NETWORK_ERROR" || error.status >= 500;
};

// One query cache per browser tab, created in state so it survives re-renders but is never shared between visitors
// on the server. Each host's layout renders its own.
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Coming back to a page within 30 seconds shows what was loaded instead of fetching it again.
            staleTime: 30 * 1000,
            retry: shouldRetry,
          },
          mutations: { retry: false },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
