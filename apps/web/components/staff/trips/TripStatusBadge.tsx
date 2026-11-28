"use client";

import { useTranslations } from "next-intl";
import type { TripStatus } from "@terhal/contracts";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

// The Figma's mapping (component "Trip status").
const tones: Record<TripStatus, BadgeTone> = {
  PENDING: "warning",
  CONFIRMED: "info",
  IN_PROGRESS: "primary",
  AWAITING_REPORT: "accent",
  COMPLETED: "success",
  CANCELLED: "danger",
};

export function TripStatusBadge({ status, className }: { status: TripStatus; className?: string }) {
  const t = useTranslations("staff.trips.status");
  return (
    <Badge tone={tones[status]} dot className={className}>
      {t(status)}
    </Badge>
  );
}
