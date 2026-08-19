import { useQuery } from "@tanstack/react-query";
import { api, queryString } from "../api/client";
import type {
  MlsCoverageResponse,
  MlsListing,
  MlsSearchResponse,
  MlsStatus,
} from "../api/types";

// All read-only — there are no mutations against the MLS. The feed is somebody
// else's system of record, and our licence will say so in writing.

export interface MlsFilters {
  /** Comma-separated county names; the API ORs them together. */
  counties?: string;
  status?: string;
  propertyType?: string;
  city?: string;
  state?: string;
  /** Dollars, not cents — RESO's ListPrice is a dollar amount. */
  minPrice?: number;
  maxPrice?: number;
  minBeds?: number;
  minBaths?: number;
  minYearBuilt?: number;
  /** ISO timestamp. The watermark an incremental sync would page on. */
  modifiedSince?: string;
  sort?: string;
  dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export const mlsKeys = {
  all: ["mls"] as const,
  status: () => ["mls", "status"] as const,
  search: (filters: MlsFilters) => ["mls", "search", filters] as const,
  property: (key: string) => ["mls", "property", key] as const,
  coverage: (sample: number) => ["mls", "coverage", sample] as const,
};

export const useMlsStatus = () =>
  useQuery({
    queryKey: mlsKeys.status(),
    queryFn: () => api.get<MlsStatus>("/mls/status"),
    // The feed's reachability changes on the timescale of an outage, not a
    // click. Re-probing on every tab focus just spends quota.
    staleTime: 60_000,
  });

export const useMlsSearch = (filters: MlsFilters, enabled = true) =>
  useQuery({
    queryKey: mlsKeys.search(filters),
    queryFn: () => api.get<MlsSearchResponse>(`/mls/search${queryString({ ...filters })}`),
    enabled,
    // Bridge bills by request against an hourly quota, so keep an identical
    // query out of the wire for a while. Nothing here is time-critical.
    staleTime: 30_000,
  });

export const useMlsProperty = (listingKey: string | undefined) =>
  useQuery({
    queryKey: mlsKeys.property(listingKey ?? ""),
    queryFn: () =>
      api.get<{ listing: MlsListing; raw: Record<string, unknown> }>(
        `/mls/property/${encodeURIComponent(listingKey ?? "")}`
      ),
    enabled: Boolean(listingKey),
  });

export const useMlsFieldCoverage = (sample: number, enabled = true) =>
  useQuery({
    queryKey: mlsKeys.coverage(sample),
    queryFn: () => api.get<MlsCoverageResponse>(`/mls/field-coverage?sample=${sample}`),
    enabled,
    // A sampling pass is the most expensive call here (full records, no
    // $select), and fill rates don't move minute to minute.
    staleTime: 5 * 60_000,
  });
