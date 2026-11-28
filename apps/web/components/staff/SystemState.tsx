"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { IconAlertTriangle, IconLock, IconSearch, type Icon } from "@tabler/icons-react";
import type { StaffPermission } from "@terhal/contracts";
import { Button } from "@/components/ui/Button";

type Kind = "forbidden" | "notFound" | "error";

const icons: Record<Kind, Icon> = {
  forbidden: IconLock,
  notFound: IconSearch,
  error: IconAlertTriangle,
};

// The 403, 404 and error states inside the dashboard's frame.
export function SystemState({
  kind,
  description,
  onRetry,
}: {
  kind: Kind;
  // Replaces the default line: which section is turned off, say.
  description?: string;
  onRetry?: () => void;
}) {
  const t = useTranslations(`staff.system.${kind}`);
  const common = useTranslations("staff.system");
  const Icon = icons[kind];

  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <span className="mb-1 flex size-16 items-center justify-center rounded-full bg-surface-muted text-muted">
          <Icon aria-hidden className="size-7" stroke={1.75} />
        </span>
        <p className="text-xs font-medium text-muted">{t("eyebrow")}</p>
        <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted">{description ?? t("description")}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {kind === "error" ? (
            <Button onClick={onRetry ?? (() => window.location.reload())}>{common("retry")}</Button>
          ) : (
            <Button asChild>
              <Link href="/">{common("home")}</Link>
            </Button>
          )}
          {kind === "notFound" && (
            <Button asChild variant="secondary">
              <Link href="/trips">{common("trips")}</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// A section the staff member has no permission for.
export function StaffForbidden({ permission }: { permission: StaffPermission }) {
  const t = useTranslations("staff.system.forbidden");
  const permissions = useTranslations("staff.permissions");
  return (
    <SystemState
      kind="forbidden"
      description={t("section", { section: permissions(`${permission}.name`) })}
    />
  );
}
