"use client";

import { useTranslations } from "next-intl";
import type { Customer } from "@terhal/contracts";
import { Badge } from "@/components/ui/Badge";

const tones = {
  ACTIVE: "success",
  UNVERIFIED: "warning",
  SUSPENDED: "danger",
  DELETED: "neutral",
} as const;

export function CustomerStatusBadge({ status }: { status: Customer["status"] }) {
  const t = useTranslations("staff.customers.statuses");
  return (
    <Badge tone={tones[status]} dot>
      {t(status)}
    </Badge>
  );
}
