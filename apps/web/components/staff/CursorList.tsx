"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Pagination, useCursorPages } from "@/components/ui/Pagination";

type Page<Row> = { data: Row[]; nextCursor: string | null };

// A cursor-paged list from the API, with its filters: changing a filter goes back to the first page.
//
//   const list = useCursorList(["staff", "drivers"], { q: "", archived: "false" }, (query) =>
//     call(staffApi.drivers.$get({ query })));
//   list.rows … <ListPagination list={list} />
export function useCursorList<Row, Filters extends Record<string, string>>(
  key: readonly unknown[],
  initial: Filters,
  fetch: (query: Partial<Filters> & { limit: string; cursor?: string }) => Promise<Page<Row>>,
  pageSize = 20,
) {
  const pages = useCursorPages();
  const [filters, setFilters] = useState(initial);

  // Empty filters are left out of the request.
  const query = {
    ...(Object.fromEntries(
      Object.entries(filters).filter(([, value]) => value !== ""),
    ) as Partial<Filters>),
    limit: String(pageSize),
    ...(pages.cursor && { cursor: pages.cursor }),
  };
  const result = useQuery({
    queryKey: [...key, query],
    queryFn: () => fetch(query),
    placeholderData: keepPreviousData,
  });

  return {
    result,
    rows: result.data?.data ?? [],
    filters,
    setFilter: <K extends keyof Filters>(name: K, value: Filters[K]) => {
      pages.reset();
      setFilters((current) => ({ ...current, [name]: value }));
    },
    pages,
    first: (pages.page - 1) * pageSize + 1,
  };
}

export function ListPagination({
  list,
}: {
  list: ReturnType<typeof useCursorList<unknown, Record<string, string>>>;
}) {
  const t = useTranslations("staff.list");
  const { pages, result, rows, first } = list;
  if (!pages.hasPrevious && !result.data?.nextCursor) return null;
  return (
    <Pagination
      hasPrevious={pages.hasPrevious}
      hasNext={Boolean(result.data?.nextCursor)}
      onPrevious={pages.previous}
      onNext={() => pages.next(result.data?.nextCursor)}
      loading={result.isFetching}
      summary={rows.length > 0 && t("showing", { first, last: first + rows.length - 1 })}
    />
  );
}
