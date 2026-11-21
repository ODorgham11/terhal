"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { DirectionalIcon } from "@/components/DirectionalIcon";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

type PaginationProps = {
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  // Disables both buttons while a page loads.
  loading?: boolean;
  // A summary between the buttons: "Page 2", "21–40".
  summary?: ReactNode;
  className?: string;
};

// Previous and next, for the API's cursor-paged lists ({ data, nextCursor }). The chevrons point along the reading
// direction, so "next" points left in Arabic.
export function Pagination({
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  loading = false,
  summary,
  className,
}: PaginationProps) {
  const t = useTranslations("common.ui");

  return (
    <nav
      aria-label={t("pagination")}
      className={cn("flex items-center justify-between gap-4", className)}
    >
      <Button variant="secondary" size="sm" onClick={onPrevious} disabled={!hasPrevious || loading}>
        <DirectionalIcon icon={IconChevronLeft} className="size-4" />
        {t("previous")}
      </Button>
      {summary && <span className="text-sm text-muted">{summary}</span>}
      <Button variant="secondary" size="sm" onClick={onNext} disabled={!hasNext || loading}>
        {t("next")}
        <DirectionalIcon icon={IconChevronRight} className="size-4" />
      </Button>
    </nav>
  );
}

// The cursors of the pages visited so far, so "previous" can go back without the API paging backwards. Put `cursor`
// in the query key and pass the response's nextCursor to next():
//
//   const pages = useCursorPages();
//   const query = useQuery({ queryKey: ["trips", pages.cursor], queryFn: () => listTrips(pages.cursor) });
//   <Pagination hasPrevious={pages.hasPrevious} hasNext={!!query.data?.nextCursor}
//     onPrevious={pages.previous} onNext={() => pages.next(query.data?.nextCursor)} />
export function useCursorPages() {
  const [stack, setStack] = useState<string[]>([]);

  const next = useCallback((cursor: string | null | undefined) => {
    if (cursor) setStack((current) => [...current, cursor]);
  }, []);
  const previous = useCallback(() => {
    setStack((current) => current.slice(0, -1));
  }, []);
  const reset = useCallback(() => {
    setStack([]);
  }, []);

  return {
    // undefined for the first page.
    cursor: stack.at(-1),
    page: stack.length + 1,
    hasPrevious: stack.length > 0,
    next,
    previous,
    reset,
  };
}
