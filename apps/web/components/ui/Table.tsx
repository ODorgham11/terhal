"use client";

import type { ComponentProps, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { fade } from "./Motion";
import { Skeleton } from "./Skeleton";

// Plain table parts: the markup stays a real <table>, so screen readers can move by row and column. Cells align to the
// inline start, numbers to the end (pass className="text-end"). It scrolls sideways inside its own box on narrow
// screens instead of widening the page.
//
//   <Table>
//     <TableHeader><TableRow><TableHead>{t("name")}</TableHead>…</TableRow></TableHeader>
//     <TableBody>
//       {query.isPending ? <TableLoading columns={4} /> :
//        rows.length === 0 ? <TableEmpty columns={4} title={t("noTrips")} /> :
//        rows.map((row) => <TableRow key={row.id}>…</TableRow>)}
//     </TableBody>
//   </Table>
export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-border bg-surface">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("bg-surface-muted/60", className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cn("[&>tr:last-child]:border-0", className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "border-b border-border transition-colors data-[selected=true]:bg-surface-muted",
        className,
      )}
      {...props}
    />
  );
}

// A row that fades in when it arrives: for lists whose rows change under the reader (filters, pages, a refetch).
export const MotionTableRow = motion.create(TableRow);

export function TableHead({ className, scope = "col", ...props }: ComponentProps<"th">) {
  return (
    <th
      scope={scope}
      className={cn(
        "h-10 px-4 text-start align-middle text-xs font-medium whitespace-nowrap text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return (
    <td className={cn("px-4 py-3 text-start align-middle text-foreground", className)} {...props} />
  );
}

type TableEmptyProps = {
  // How many columns the table has, so the message spans them.
  columns: number;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
};

// One row across the table saying there's nothing here, with what to do about it.
export function TableEmpty({ columns, title, description, action }: TableEmptyProps) {
  const t = useTranslations("common.ui");

  return (
    <motion.tr {...fade}>
      <td colSpan={columns} className="px-4 py-12 text-center">
        <div className="flex flex-col items-center gap-1.5">
          <p className="text-base font-semibold text-foreground">{title ?? t("noResults")}</p>
          {description && <p className="text-[0.8125rem] text-muted">{description}</p>}
          {action}
        </div>
      </td>
    </motion.tr>
  );
}

// Placeholder rows while the first page loads, shaped like the table so nothing jumps when it arrives.
export function TableLoading({ columns, rows = 5 }: { columns: number; rows?: number }) {
  const t = useTranslations("common.ui");

  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} className="border-b border-border" aria-hidden={row > 0 || undefined}>
          {Array.from({ length: columns }, (_, column) => (
            <td key={column} className="px-4 py-3">
              {row === 0 && column === 0 && <span className="sr-only">{t("loading")}</span>}
              <Skeleton className={cn("h-4", column === 0 ? "w-32" : "w-20")} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
