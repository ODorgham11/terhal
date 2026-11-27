import { queryOptions } from "@tanstack/react-query";
import { call, staffApi } from "@/lib/api";

// Queries the shell and several pages share, so they hit one cache entry.

// The front page's counts; the sidebar shows the unassigned one on Trips.
export const overviewQuery = queryOptions({
  queryKey: ["staff", "overview"],
  queryFn: () => call(staffApi.overview.$get()),
  refetchInterval: 60_000,
});

// The bell's dot.
export const unreadCountQuery = queryOptions({
  queryKey: ["staff", "notifications", "unread-count"],
  queryFn: () => call(staffApi.notifications["unread-count"].$get()),
  refetchInterval: 30_000,
});
