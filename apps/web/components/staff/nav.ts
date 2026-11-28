import {
  IconBuildingStore,
  IconCar,
  IconCategory,
  IconChartBar,
  IconId,
  IconLayoutDashboard,
  IconMapPin,
  IconRoute,
  IconSteeringWheel,
  IconTag,
  IconUsers,
  IconUsersGroup,
  type Icon,
} from "@tabler/icons-react";
import type { StaffPermission } from "@terhal/contracts";

export type NavKey =
  | "overview"
  | "trips"
  | "drivers"
  | "vehicles"
  | "offices"
  | "prices"
  | "tripClasses"
  | "locations"
  | "customers"
  | "team"
  | "analytics"
  | "brands";

export type NavItem = {
  key: NavKey;
  href: string;
  icon: Icon;
  // Staff without it don't see the item at all: hidden, not disabled (the API refuses them anyway).
  permission: StaffPermission;
};

export type NavGroup = { key: "main" | "fleet" | "pricing" | "management"; items: NavItem[] };

// The sidebar, in the Figma's order. The first group has no label.
export const navGroups: NavGroup[] = [
  {
    key: "main",
    items: [
      { key: "overview", href: "/", icon: IconLayoutDashboard, permission: "trips" },
      { key: "trips", href: "/trips", icon: IconRoute, permission: "trips" },
    ],
  },
  {
    key: "fleet",
    items: [
      { key: "drivers", href: "/drivers", icon: IconSteeringWheel, permission: "fleet" },
      { key: "vehicles", href: "/vehicles", icon: IconCar, permission: "fleet" },
      { key: "offices", href: "/offices", icon: IconBuildingStore, permission: "fleet" },
    ],
  },
  {
    key: "pricing",
    items: [
      { key: "prices", href: "/prices", icon: IconTag, permission: "pricing" },
      { key: "tripClasses", href: "/trip-classes", icon: IconCategory, permission: "pricing" },
      { key: "locations", href: "/locations", icon: IconMapPin, permission: "pricing" },
    ],
  },
  {
    key: "management",
    items: [
      { key: "customers", href: "/customers", icon: IconUsers, permission: "customers" },
      { key: "team", href: "/team", icon: IconUsersGroup, permission: "team" },
      { key: "analytics", href: "/analytics", icon: IconChartBar, permission: "analytics" },
      { key: "brands", href: "/brands", icon: IconId, permission: "team" },
    ],
  },
];

// The groups a staff member can use, empty ones dropped.
export const visibleGroups = (permissions: readonly StaffPermission[]) =>
  navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => permissions.includes(item.permission)),
    }))
    .filter((group) => group.items.length > 0);

// "/trips/abc" is under Trips; "/" only matches itself.
export const isActive = (href: string, pathname: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
