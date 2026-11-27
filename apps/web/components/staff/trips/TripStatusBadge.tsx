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

export function TripStatusBadge({ status }: { status: TripStatus }) {
  const t = useTranslations("staff.trips.status");
  return (
    <Badge tone={tones[status]} dot>
      {t(status)}
    </Badge>
  );
}
