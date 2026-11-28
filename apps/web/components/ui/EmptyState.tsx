import type { ReactNode } from "react";
import type { Icon as TablerIcon } from "@tabler/icons-react";
import { cn } from "@/lib/cn";

type EmptyStateProps = {
  icon?: TablerIcon;
  title: ReactNode;
  description?: ReactNode;
  // What to do about it: "Invite a colleague", "Try again".
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
    >
      {Icon && <Icon aria-hidden stroke={1.5} className="size-10 text-muted" />}
      <div className="flex max-w-sm flex-col gap-0.5">
        <p className="text-base font-semibold text-foreground">{title}</p>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
