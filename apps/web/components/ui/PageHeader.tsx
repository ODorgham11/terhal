import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  // Above the title: a back link, say.
  eyebrow?: ReactNode;
  // At the inline end: the page's main buttons.
  actions?: ReactNode;
  className?: string;
};

// The top of a page: its one <h1>, a line about it, and its actions.
export function PageHeader({ title, description, eyebrow, actions, className }: PageHeaderProps) {
  return (
    <header
      // Side by side only once there's room for both, with a clear gap between the words and the buttons; until then the
      // buttons sit on their own line under them.
      className={cn(
        "flex flex-col gap-x-12 gap-y-4 lg:flex-row lg:items-end lg:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow}
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>}
    </header>
  );
}
