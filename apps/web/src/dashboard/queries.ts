import { useQuery } from "@tanstack/react-query";
import { api, queryString } from "../api/client";
import type { DashboardData } from "../api/types";

// The browser's IANA zone. The server buckets months and weeks in it, so the
// charts agree with the calendar on the agent's wall.
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export const dashboardKeys = {
  all: ["dashboard"] as const,
};

export const useDashboard = () =>
  useQuery({
    queryKey: dashboardKeys.all,
    queryFn: () => api.get<DashboardData>(`/dashboard${queryString({ tz: TIME_ZONE })}`),
  });
