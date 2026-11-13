import { createContext, useContext } from "react";
import type { AuthUser } from "../api/types";

// The context and its hook live apart from AuthProvider.tsx because a file
// that exports a component alongside anything else loses fast refresh (the
// react-refresh lint rule enforces this).

export interface AuthContextValue {
  /**
   * `loading` until the first /auth/me answers. `error` means that request
   * itself failed — the API is unreachable — which is not the same thing as
   * being signed out and must not be shown as a login form.
   */
  status: "loading" | "ready" | "error";
  user: AuthUser | null;
  googleAvailable: boolean;
  login: (values: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-ask the server who is signed in. Used by the error screen's Retry. */
  refresh: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export const useAuth = (): AuthContextValue => {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
};
