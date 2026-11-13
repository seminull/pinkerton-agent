import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryString } from "../api/client";
import type {
  Listing,
  ListingLookup,
  ListingPhoto,
  ListingStatus,
  ListResponse,
} from "../api/types";

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
  photos: (id: string) => ["listings", "photos", id] as const,
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

export const useListingPhotos = (id: string | undefined) =>
  useQuery({
    queryKey: listingKeys.photos(id ?? ""),
    queryFn: () => api.get<{ photos: ListingPhoto[] }>(`/listings/${id}/photos`),
    enabled: Boolean(id),
  });

export const listingPhotoUrl = (listingId: string, photoId: string): string =>
  `/api/listings/${listingId}/photos/${photoId}/content`;

export const useUploadListingPhotos = (listingId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    // One request per image stays within the proxy limit and lets the server
    // reject a bad file without discarding the other files from the drop.
    mutationFn: async (files: File[]) => {
      const uploaded: ListingPhoto[] = [];
      for (const file of files) {
        const form = new FormData();
        form.append("photo", file);
        const result = await api.postForm<{ photo: ListingPhoto }>(
          `/listings/${listingId}/photos`,
          form
        );
        uploaded.push(result.photo);
      }
      return uploaded;
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: listingKeys.photos(listingId) }),
  });
};

export const useDeleteListingPhoto = (listingId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) =>
      api.delete<void>(`/listings/${listingId}/photos/${photoId}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: listingKeys.photos(listingId) }),
  });
};

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
    | "listingType"
    | "listPriceCents"
    | "bedrooms"
    | "bathrooms"
    | "livingAreaSqft"
    | "lotAcres"
    | "yearBuilt"
    | "parcelNumber"
    | "listedOn"
    | "sellerContactId"
    | "externalLinks"
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

export const useLookupMatrixListing = () =>
  useMutation({
    mutationFn: (url: string) =>
      api.post<{ lookup: ListingLookup }>("/listings/matrix/lookup", { url }),
  });

export interface MatrixPhotoImportResult {
  imported: number;
  alreadyPresent: number;
  failed: number;
  omitted: number;
}

export const useImportMatrixPhotos = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ listingId, url }: { listingId: string; url: string }) =>
      api.post<MatrixPhotoImportResult>(`/listings/${listingId}/matrix-photos`, { url }),
    onSuccess: (_result, variables) =>
      queryClient.invalidateQueries({ queryKey: listingKeys.photos(variables.listingId) }),
  });
};
