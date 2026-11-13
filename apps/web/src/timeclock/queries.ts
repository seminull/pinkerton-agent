import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryString } from "../api/client";
import type { ListResponse, TimeEntry, TimeSummary } from "../api/types";

export const timeKeys = {
  all: ["time-entries"] as const,
  active: ["time-entries", "active"] as const,
  list: (offset: number, limit: number) => ["time-entries", "list", offset, limit] as const,
  summary: (from?: string, to?: string) => ["time-entries", "summary", from, to] as const,
};

export const useActiveEntry = () =>
  useQuery({
    queryKey: timeKeys.active,
    queryFn: () => api.get<{ entry: TimeEntry | null }>("/time-entries/active"),
    // The one query here that overrides the app-wide "don't refetch on focus":
    // the running task can be stopped from another tab or device, and coming
    // back to a clock that is still counting for a task that already ended is
    // exactly the kind of wrong a time tracker can't be.
    refetchOnWindowFocus: true,
  });

export const useTimeEntries = (offset: number, limit: number) =>
  useQuery({
    queryKey: timeKeys.list(offset, limit),
    queryFn: () =>
      api.get<ListResponse<TimeEntry>>(`/time-entries${queryString({ offset, limit })}`),
  });

/** Totals for a range, or for everything when no range is given. */
export const useTimeSummary = (range?: { from: string; to: string }) =>
  useQuery({
    queryKey: timeKeys.summary(range?.from, range?.to),
    queryFn: () =>
      api.get<{ summary: TimeSummary }>(`/time-entries/summary${queryString({ ...range })}`),
  });

export interface StartTaskInput {
  category: string;
  task: string;
  reference: string | null;
  workType: string;
  notes: string | null;
}

// Starting, stopping, and deleting each change the running task, the history,
// and both sets of totals at once, so each invalidates the whole tree rather
// than trying to patch four caches by hand.
const useInvalidateAll = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: timeKeys.all });
};

export const useStartTask = () => {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: StartTaskInput) =>
      api.post<{ entry: TimeEntry }>("/time-entries/start", input),
    // onSettled, not onSuccess: a 409 "already running" means this tab's idea
    // of the state was stale, and refetching is what corrects it.
    onSettled: invalidate,
  });
};

export const useStopTask = () => {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: () => api.post<{ entry: TimeEntry }>("/time-entries/stop", undefined),
    onSettled: invalidate,
  });
};

export const useDeleteTimeEntry = () => {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/time-entries/${id}`),
    onSettled: invalidate,
  });
};

// Every completed entry, oldest first, for the CSV export. Walks the pages
// because the API caps a page at 100 rows — an export that silently stopped at
// the first hundred would be worse than no export.
const EXPORT_PAGE = 100;
export const fetchAllTimeEntries = async (): Promise<TimeEntry[]> => {
  const all: TimeEntry[] = [];
  for (let offset = 0; ; offset += EXPORT_PAGE) {
    const page = await api.get<ListResponse<TimeEntry>>(
      `/time-entries${queryString({ offset, limit: EXPORT_PAGE })}`
    );
    all.push(...page.results);
    if (page.results.length < EXPORT_PAGE || all.length >= page.total) break;
  }
  return all.reverse();
};
