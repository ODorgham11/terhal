import type { Icon as TablerIconComponent, IconProps } from "@tabler/icons-react";
import { cn } from "@/lib/cn";

type DirectionalIconProps = IconProps & {
  icon: TablerIconComponent;
};

// An icon that points along the reading direction: arrows and chevrons for next, back, open, "go to". Pick the icon as
// it reads in English (IconChevronRight for "next", IconArrowLeft for "back") and wrap it; in Arabic it's mirrored, so
// "next" points left. Icons that mean a real direction (a map's north, a sort order, undo) are never wrapped.
//
//   <DirectionalIcon icon={IconChevronRight} className="size-4" />
//
// Decorative by default (aria-hidden): the button or link around it carries the label.
export function DirectionalIcon({ icon: Icon, className, ...props }: DirectionalIconProps) {
  return <Icon aria-hidden className={cn("rtl:-scale-x-100", className)} {...props} />;
}
