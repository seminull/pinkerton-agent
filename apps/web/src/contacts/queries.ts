import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryString } from "../api/client";
import type { Contact, ContactStage, ContactType, ListResponse } from "../api/types";

export interface ContactFilters {
  q?: string;
  stage?: ContactStage | "";
  type?: ContactType | "";
  limit?: number;
  offset?: number;
}

// One place that derives a cache key from the filters, so every hook that
// touches contacts invalidates the same entries. Getting this wrong is how
// stale lists survive a create.
export const contactKeys = {
  all: ["contacts"] as const,
  list: (filters: ContactFilters) => ["contacts", "list", filters] as const,
  detail: (id: string) => ["contacts", "detail", id] as const,
};

export const useContacts = (filters: ContactFilters) =>
  useQuery({
    queryKey: contactKeys.list(filters),
    queryFn: () =>
      api.get<ListResponse<Contact>>(`/contacts${queryString({ ...filters })}`),
  });

export const useContact = (id: string | undefined) =>
  useQuery({
    queryKey: contactKeys.detail(id ?? ""),
    queryFn: () => api.get<{ contact: Contact }>(`/contacts/${id}`),
    enabled: Boolean(id),
  });

export type ContactInput = Partial<
  Pick<
    Contact,
    "firstName" | "lastName" | "email" | "phone" | "type" | "stage" | "source" | "notes"
  >
>;

export type ImportedContactInput = Pick<
  Contact,
  "firstName" | "lastName" | "email" | "phone"
> &
  Partial<Pick<Contact, "notes">>;

export interface ImportContactsInput {
  contacts: ImportedContactInput[];
  source: "Phone import" | "Matrix CSV";
}

export interface ImportContactsResult {
  imported: number;
  duplicates: number;
}

export const useCreateContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ContactInput) =>
      api.post<{ contact: Contact }>("/contacts", input),
    // Invalidate the whole contacts tree rather than patching one list: the new
    // row's position depends on the active sort and filters, which this hook
    // doesn't know.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contactKeys.all }),
  });
};

export const useUpdateContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: ContactInput & { id: string }) =>
      api.patch<{ contact: Contact }>(`/contacts/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contactKeys.all }),
  });
};

export const useImportContacts = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportContactsInput) =>
      api.post<ImportContactsResult>("/contacts/import", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contactKeys.all }),
  });
};

export const useDeleteContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/contacts/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contactKeys.all }),
  });
};
