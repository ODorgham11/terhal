"use client";

import { useTranslations } from "next-intl";
import {
  IconCar,
  IconChartBar,
  IconRoute,
  IconTag,
  IconUsers,
  IconUsersGroup,
  type Icon,
} from "@tabler/icons-react";
import { staffPermissions, type StaffPermission } from "@terhal/contracts";
import { Badge } from "@/components/ui/Badge";
import { Switch } from "@/components/ui/Switch";

const icons: Record<StaffPermission, Icon> = {
  trips: IconRoute,
  fleet: IconCar,
  pricing: IconTag,
  customers: IconUsers,
  team: IconUsersGroup,
  analytics: IconChartBar,
};

type Props = {
  value: StaffPermission[];
  onChange: (permissions: StaffPermission[]) => void;
  disabled?: boolean;
};

// One switch per permission, each with what it allows.
export function PermissionSwitches({ value, onChange, disabled }: Props) {
  const t = useTranslations("staff.permissions");
  return (
    <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
      {staffPermissions.map((permission) => {
        const Icon = icons[permission];
        return (
          <li key={permission} className="flex items-center gap-3 px-4 py-3">
            <Icon aria-hidden className="size-5 shrink-0 text-muted" stroke={1.75} />
            <Switch
              className="flex-1"
              label={t(`${permission}.name`)}
              description={t(`${permission}.description`)}
              checked={value.includes(permission)}
              disabled={disabled}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? staffPermissions.filter((p) => p === permission || value.includes(p))
                    : value.filter((p) => p !== permission),
                )
              }
            />
          </li>
        );
      })}
    </ul>
  );
}

// "Full access" for someone with every permission, otherwise a chip per permission.
export function PermissionChips({ permissions }: { permissions: StaffPermission[] }) {
  const t = useTranslations("staff.permissions");
  const team = useTranslations("staff.team");
  if (permissions.length === 0)
    return <span className="text-xs text-muted">{team("noAccess")}</span>;
  // Always in a wrapping row, so each chip keeps its pill shape even where its parent stretches its children.
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {permissions.length === staffPermissions.length ? (
        <Badge tone="primary">{team("fullAccess")}</Badge>
      ) : (
        staffPermissions
          .filter((permission) => permissions.includes(permission))
          .map((permission) => (
            <Badge key={permission} tone="neutral">
              {t(`${permission}.name`)}
            </Badge>
          ))
      )}
    </span>
  );
}
