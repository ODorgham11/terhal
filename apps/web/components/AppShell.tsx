import type { ReactNode } from "react";
import { LocaleSwitcher } from "./LocaleSwitcher";

type AppShellProps = {
  title: string;
  // At the header's inline end, before the locale switcher: an account menu, say.
  actions?: ReactNode;
  children: ReactNode;
};

// Each host's frame: a header with its name and the locale switcher, then the page. Deliberately bare; navigation
// arrives with the pages.
export function AppShell({ title, actions, children }: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <span className="text-base font-semibold text-foreground">{title}</span>
          <div className="flex items-center gap-2">
            {actions}
            <LocaleSwitcher />
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6 sm:px-6">
        {children}
      </div>
    </div>
  );
}
