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
  const chip = "rounded-full px-2 py-0.5 text-xs font-medium";
  if (permissions.length === staffPermissions.length) {
    return <span className={`${chip} bg-primary-soft text-primary`}>{team("fullAccess")}</span>;
  }
  if (permissions.length === 0)
    return <span className="text-xs text-muted">{team("noAccess")}</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {staffPermissions
        .filter((permission) => permissions.includes(permission))
        .map((permission) => (
          <span key={permission} className={`${chip} bg-surface-muted text-foreground`}>
            {t(`${permission}.name`)}
          </span>
        ))}
    </span>
  );
}
