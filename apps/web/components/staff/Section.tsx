import type { ReactNode } from "react";

// A titled block on a settings page (as on Hagz's account page): the title, a muted line under it, then what it holds.
// Sections after the first sit below a hairline, 32px down; siblings only, so the `[&+&]` rule can see them.
export function Section({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border pt-8 first:border-t-0 first:pt-0 [&+&]:mt-8">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-0.5 text-sm text-muted">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}
