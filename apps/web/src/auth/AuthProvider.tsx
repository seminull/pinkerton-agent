import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, UNAUTHORIZED_EVENT } from "../api/client";
import type { AuthStatus, AuthUser } from "../api/types";
import { AuthContext, type AuthContextValue } from "./authContext";

// Owns "who is signed in". Plain state rather than a TanStack query on purpose:
// signing out clears the whole query cache, and the answer to "who am I" must
// not be one of the things that gets cleared and refetched along with it.
export default function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [googleAvailable, setGoogleAvailable] = useState(false);
  // Bumped by refresh() to re-run the load effect.
  const [attempt, setAttempt] = useState(0);
  const queryClient = useQueryClient();

  useEffect(() => {
    // Guards against a slow response landing after unmount, or after a newer
    // attempt has already answered.
    let active = true;
    api
      .get<AuthStatus>("/auth/me")
      .then((response) => {
        if (!active) return;
        setUser(response.user);
        setGoogleAvailable(response.providers.google);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error("Could not load the current account", error);
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  // Every cached list belongs to the account that fetched it. Cleared — not
  // invalidated — whenever that account goes away, because invalidating keeps
  // the old rows on screen while the refetch runs, and on a shared computer
  // that means the next person sees the previous agent's contacts for a moment.
  const dropSession = useCallback(() => {
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, dropSession);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, dropSession);
  }, [dropSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      googleAvailable,
      login: async (values) => {
        const response = await api.post<{ user: AuthUser }>("/auth/login", values);
        setUser(response.user);
      },
      logout: async () => {
        await api.post<void>("/auth/logout", undefined);
        dropSession();
      },
      refresh: () => {
        setStatus("loading");
        setAttempt((n) => n + 1);
      },
    }),
    [status, user, googleAvailable, dropSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
