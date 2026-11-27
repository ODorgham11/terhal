"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

export const tripKey = (id: string) => ["staff", "trip", id] as const;

// After a trip changes: reload it, the lists it shows up in, and the counts.
export function useTripChanged() {
  const client = useQueryClient();
  return useCallback(
    async (id: string) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: tripKey(id) }),
        client.invalidateQueries({ queryKey: ["staff", "trips"] }),
        client.invalidateQueries({ queryKey: ["staff", "overview"] }),
      ]);
    },
    [client],
  );
}
