import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryString } from "../api/client";
import type {
  ListResponse,
  TimeDayTotals,
  TimeEntry,
  TimeImportResult,
  TimeOption,
  TimeOptions,
  TimeSummary,
} from "../api/types";

export const timeKeys = {
  all: ["time-entries"] as const,
  active: ["time-entries", "active"] as const,
  list: (offset: number, limit: number, from?: string, to?: string) =>
    ["time-entries", "list", offset, limit, from, to] as const,
  daily: (from: string, to: string) => ["time-entries", "daily", from, to] as const,
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

export interface TimeRange {
  from: string;
  to: string;
}

/** A page of completed entries, newest first, optionally limited to a range. */
export const useTimeEntries = (offset: number, limit: number, range?: TimeRange) =>
  useQuery({
    queryKey: timeKeys.list(offset, limit, range?.from, range?.to),
    queryFn: () =>
      api.get<ListResponse<TimeEntry>>(
        `/time-entries${queryString({ offset, limit, ...range })}`
      ),
  });

// The browser's IANA zone ("America/Chicago"). Sent with the per-day request
// because only the browser knows where its user's midnight falls.
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Per-day totals across a range, for the calendar's cells. */
export const useDailyTotals = (range: TimeRange) =>
  useQuery({
    queryKey: timeKeys.daily(range.from, range.to),
    queryFn: () =>
      api.get<{ days: TimeDayTotals[] }>(
        `/time-entries/daily${queryString({ ...range, tz: TIME_ZONE })}`
      ),
    // Paging between months keeps the previous month's numbers on screen until
    // the new ones arrive, instead of blanking every cell for a moment.
    placeholderData: (previous) => previous,
  });

/** Totals for a range, or for everything when no range is given. */
export const useTimeSummary = (range?: TimeRange) =>
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

export interface UpdateEntryInput {
  id: string;
  category: string;
  task: string;
  reference: string | null;
  workType: string;
  notes: string | null;
  /** ISO instants. */
  startedAt: string;
  endedAt: string;
}

export const useUpdateTimeEntry = () => {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateEntryInput) =>
      api.patch<{ entry: TimeEntry }>(`/time-entries/${id}`, input),
    // onSuccess, not onSettled: a failed save changed nothing on the server,
    // and refetching would only make the table flicker behind the open form.
    onSuccess: invalidate,
  });
};

export const useDeleteTimeEntry = () => {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/time-entries/${id}`),
    onSettled: invalidate,
  });
};

// Every completed entry, oldest first, for the CSV export — all of them, or
// only those in `range` (one day's export). Walks the pages because the API
// caps a page at 100 rows — an export that silently stopped at the first
// hundred would be worse than no export.
const EXPORT_PAGE = 100;
export const fetchAllTimeEntries = async (range?: TimeRange): Promise<TimeEntry[]> => {
  const all: TimeEntry[] = [];
  for (let offset = 0; ; offset += EXPORT_PAGE) {
    const page = await api.get<ListResponse<TimeEntry>>(
      `/time-entries${queryString({ offset, limit: EXPORT_PAGE, ...range })}`
    );
    all.push(...page.results);
    if (page.results.length < EXPORT_PAGE || all.length >= page.total) break;
  }
  return all.reverse();
};

// --- Setup: categories and work types ---------------------------------------

export const timeOptionKeys = { all: ["time-options"] as const };

/** Which of the two lists a Setup request is about; also its URL segment. */
export type OptionList = "categories" | "work-types";

export const useTimeOptions = () =>
  useQuery({
    queryKey: timeOptionKeys.all,
    queryFn: () => api.get<TimeOptions>("/time-options"),
  });

// A change on the Setup tab can alter far more than the lists: renaming a
// category rewrites the entries that use it, and flipping "counts as a break"
// moves time between totals. So every Setup mutation refreshes the options AND
// the whole time-entries tree, rather than guessing which totals moved.
const useInvalidateOptions = () => {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: timeOptionKeys.all }),
      queryClient.invalidateQueries({ queryKey: timeKeys.all }),
    ]);
};

export type OptionPatch = Partial<
  Pick<TimeOption, "name" | "archived" | "isBreak" | "countsAsOwnTime">
>;

export const useCreateOption = (list: OptionList) => {
  const invalidate = useInvalidateOptions();
  return useMutation({
    mutationFn: (input: OptionPatch & { name: string }) =>
      api.post<{ option: TimeOption }>(`/time-options/${list}`, input),
    onSuccess: invalidate,
  });
};

export const useUpdateOption = (list: OptionList) => {
  const invalidate = useInvalidateOptions();
  return useMutation({
    mutationFn: ({ id, ...patch }: OptionPatch & { id: string }) =>
      api.patch<{ option: TimeOption }>(`/time-options/${list}/${id}`, patch),
    onSuccess: invalidate,
  });
};

export const useDeleteOption = (list: OptionList) => {
  const invalidate = useInvalidateOptions();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/time-options/${list}/${id}`),
    onSuccess: invalidate,
  });
};

export const useReorderOptions = (list: OptionList) => {
  const invalidate = useInvalidateOptions();
  return useMutation({
    mutationFn: (ids: string[]) =>
      api.post<{ options: TimeOption[] }>(`/time-options/${list}/reorder`, { ids }),
    // onSettled: a failed reorder should snap the list back to what the
    // server actually has.
    onSettled: invalidate,
  });
};

// --- backfill import ---------------------------------------------------------

export interface ImportEntryInput {
  category: string;
  task: string;
  reference: string | null;
  workType: string;
  notes: string | null;
  /** ISO instants. */
  startedAt: string;
  endedAt: string;
}

export const useImportTimeEntries = () => {
  // An import adds entries AND can add categories and work types, so both
  // trees are refreshed — the same pair a Setup change refreshes.
  const invalidate = useInvalidateOptions();
  return useMutation({
    mutationFn: (entries: ImportEntryInput[]) =>
      api.post<TimeImportResult>("/time-entries/import", { entries }),
    onSuccess: invalidate,
  });
};
