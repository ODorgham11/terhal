import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

type SectionCardProps = {
  title: ReactNode;
  // At the inline end of the title: a button or a count.
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
};

// A titled card on a detail page: the trip's route, a driver's ledger, a customer's contact details.
export function SectionCard({ title, aside, className, children }: SectionCardProps) {
  return (
    <Card className={cn("flex flex-col gap-4 p-5", className)}>
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {aside}
      </div>
      {children}
    </Card>
  );
}

// A label and its value on one line, in a SectionCard's <dl>.
export function InfoRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-end break-words text-foreground">{children}</dd>
    </div>
  );
}

export function InfoList({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col gap-3">{children}</dl>;
}
