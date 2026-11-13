import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryString } from "../api/client";
import type { Listing, ListingLookup, ListingStatus, ListResponse } from "../api/types";

export interface ListingFilters {
  q?: string;
  status?: ListingStatus | "";
  city?: string;
  /** Cents, matching the column — the form converts from dollars. */
  minPrice?: number;
  maxPrice?: number;
  limit?: number;
  offset?: number;
}

export const listingKeys = {
  all: ["listings"] as const,
  list: (filters: ListingFilters) => ["listings", "list", filters] as const,
  detail: (id: string) => ["listings", "detail", id] as const,
};

export const useListings = (filters: ListingFilters) =>
  useQuery({
    queryKey: listingKeys.list(filters),
    queryFn: () =>
      api.get<ListResponse<Listing>>(`/listings${queryString({ ...filters })}`),
  });

export const useListing = (id: string | undefined) =>
  useQuery({
    queryKey: listingKeys.detail(id ?? ""),
    queryFn: () => api.get<{ listing: Listing }>(`/listings/${id}`),
    enabled: Boolean(id),
  });

export type ListingInput = Partial<
  Pick<
    Listing,
    | "addressLine1"
    | "addressLine2"
    | "city"
    | "state"
    | "postalCode"
    | "mlsNumber"
    | "status"
    | "listPriceCents"
    | "bedrooms"
    | "bathrooms"
    | "livingAreaSqft"
    | "lotAcres"
    | "yearBuilt"
    | "listedOn"
    | "sellerContactId"
    | "notes"
  >
>;

export const useCreateListing = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ListingInput) =>
      api.post<{ listing: Listing }>("/listings", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: listingKeys.all }),
  });
};

export const useUpdateListing = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: ListingInput & { id: string }) =>
      api.patch<{ listing: Listing }>(`/listings/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: listingKeys.all }),
  });
};

export const useDeleteListing = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/listings/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: listingKeys.all }),
  });
};

// --- Add with Zillow ---------------------------------------------------------

// Whether the server has a BigDistrict key. Asked once and kept: it only
// changes with a redeploy, and the answer decides whether the button exists.
export const useListingLookupAvailable = () =>
  useQuery({
    queryKey: ["listings", "lookup-available"] as const,
    queryFn: () => api.get<{ available: boolean }>("/listings/lookup"),
    staleTime: Infinity,
  });

// Looks a link up and returns a DRAFT. Nothing is saved and no list changes,
// so unlike the other mutations here there is nothing to invalidate.
export const useLookupListing = () =>
  useMutation({
    mutationFn: (url: string) =>
      api.post<{ lookup: ListingLookup }>("/listings/lookup", { url }),
  });
