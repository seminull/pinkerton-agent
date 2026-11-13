import { useQuery } from "@tanstack/react-query";
import { api, queryString } from "../api/client";
import type {
  ListResponse,
  SharedTimeEntry,
  TimeDayTotals,
  TimeShare,
  TimeSummary,
} from "../api/types";

const shareKeys = {
  metadata: (token: string) => ["time-share", token] as const,
  entries: (token: string, day: string, offset: number, limit: number) =>
    ["time-share", token, "entries", day, offset, limit] as const,
  daily: (token: string, fromDay: string, toDay: string) =>
    ["time-share", token, "daily", fromDay, toDay] as const,
  summary: (token: string) => ["time-share", token, "summary"] as const,
};

export const useSharedTimeClock = (token: string) =>
  useQuery({
    queryKey: shareKeys.metadata(token),
    queryFn: () => api.get<{ share: TimeShare }>(`/public/time-shares/${token}`),
  });

export const useSharedEntries = (
  token: string,
  day: string,
  offset: number,
  limit: number
) =>
  useQuery({
    queryKey: shareKeys.entries(token, day, offset, limit),
    queryFn: () =>
      api.get<ListResponse<SharedTimeEntry>>(
        `/public/time-shares/${token}/entries${queryString({ day, offset, limit })}`
      ),
  });

export const useSharedDailyTotals = (token: string, fromDay: string, toDay: string) =>
  useQuery({
    queryKey: shareKeys.daily(token, fromDay, toDay),
    queryFn: () =>
      api.get<{ days: TimeDayTotals[] }>(
        `/public/time-shares/${token}/daily${queryString({ fromDay, toDay })}`
      ),
    placeholderData: (previous) => previous,
  });

export const useSharedSummary = (token: string) =>
  useQuery({
    queryKey: shareKeys.summary(token),
    queryFn: () =>
      api.get<{ summary: TimeSummary }>(`/public/time-shares/${token}/summary`),
  });
