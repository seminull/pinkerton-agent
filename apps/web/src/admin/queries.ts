import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryString } from "../api/client";
import type { AdminUser, ListResponse } from "../api/types";

export interface UserFilters {
  q?: string;
  limit?: number;
  offset?: number;
}

export const adminUserKeys = {
  all: ["admin", "users"] as const,
  list: (filters: UserFilters) => ["admin", "users", "list", filters] as const,
};

export const useAdminUsers = (filters: UserFilters, enabled: boolean) =>
  useQuery({
    queryKey: adminUserKeys.list(filters),
    queryFn: () =>
      api.get<ListResponse<AdminUser>>(`/admin/users${queryString({ ...filters })}`),
    // Off for a non-admin who typed the URL: the answer is a certain 403, and
    // the page says so without asking.
    enabled,
  });

export interface CreateUserInput {
  email: string;
  firstName: string;
  lastName: string;
  role: AdminUser["role"];
  /** Omitted for an account that will only ever sign in with Google. */
  password?: string;
}

export type UpdateUserInput = Partial<
  Pick<AdminUser, "firstName" | "lastName" | "role" | "status">
> & { password?: string };

// Every mutation invalidates the whole list tree rather than patching a row:
// a role or status change can move a row under the active sort and search,
// which these hooks don't know about.
export const useCreateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) =>
      api.post<{ user: AdminUser }>("/admin/users", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminUserKeys.all }),
  });
};

export const useUpdateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateUserInput & { id: string }) =>
      api.patch<{ user: AdminUser }>(`/admin/users/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminUserKeys.all }),
  });
};

export const useRevokeSessions = () =>
  useMutation({
    mutationFn: (id: string) =>
      api.post<{ revoked: number }>(`/admin/users/${id}/revoke-sessions`, undefined),
  });
