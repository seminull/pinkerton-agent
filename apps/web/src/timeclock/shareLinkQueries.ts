import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryString } from "../api/client";
import type { ListResponse, TimeShareAccess, TimeShareStatus, TimeShareSummary } from "../api/types";

// The owner's side of share links: listing them, reading who opened them, and
// removing them. The public viewer's queries are in sharedQueries.ts; the two
// never share keys, so nothing cached for a signed-out viewer can surface here.

export const shareLinkKeys = {
  all: ["time-share-links"] as const,
  list: (status: TimeShareStatus | undefined, offset: number, limit: number) =>
    ["time-share-links", "list", status, offset, limit] as const,
  accesses: (id: string, offset: number, limit: number) =>
    ["time-share-links", "accesses", id, offset, limit] as const,
};

export const useShareLinks = (
  status: TimeShareStatus | undefined,
  offset: number,
  limit: number
) =>
  useQuery({
    queryKey: shareLinkKeys.list(status, offset, limit),
    queryFn: () =>
      api.get<ListResponse<TimeShareSummary>>(
        `/time-shares${queryString({ status, offset, limit })}`
      ),
    placeholderData: (previous) => previous,
    // The counts change when someone else opens a link, not when this user
    // does anything, so coming back to the tab is the moment to re-ask.
    refetchOnWindowFocus: true,
  });

export const useShareAccesses = (id: string, offset: number, limit: number) =>
  useQuery({
    queryKey: shareLinkKeys.accesses(id, offset, limit),
    queryFn: () =>
      api.get<ListResponse<TimeShareAccess>>(
        `/time-shares/${id}/accesses${queryString({ offset, limit })}`
      ),
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: true,
  });

export const useRemoveShareLink = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<unknown>(`/time-shares/${id}`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: shareLinkKeys.all }),
  });
};
