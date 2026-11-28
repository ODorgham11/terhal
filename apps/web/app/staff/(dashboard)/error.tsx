"use client";

import { useEffect } from "react";
import { SystemState } from "@/components/staff/SystemState";

// A page that threw while rendering: say so inside the frame, and offer to try again.
export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <SystemState kind="error" onRetry={retry} />;
}
