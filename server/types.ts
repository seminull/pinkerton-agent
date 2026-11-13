// Wire types — the shapes the API actually sends. Kept separate from the
// Sequelize attribute types (server/sequelize/models/index.d.ts) because what
// goes over the wire is not what sits in the table: timestamps become ISO
// strings and DECIMAL columns arrive from pg as strings.
export interface ListResponse<T> {
  results: T[];
  total: number;
}

export interface ApiError {
  error: string;
  /** Present on 422s: which fields failed and why. */
  details?: Record<string, string>;
}

/** The signed-in user as the client sees them. Never the row — no hash. */
export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  role: "user" | "admin";
}

/** An account as the admin Users screen sees it. */
export interface AdminUser extends AuthUser {
  status: "active" | "disabled";
  /** True once a provider has vouched for the address (a Google sign-in). */
  emailVerified: boolean;
  /** Whether password sign-in is possible. Never the hash. */
  hasPassword: boolean;
  /** Linked sign-in providers, e.g. ["google"]. */
  providers: string[];
  lastLoginAt: string | null;
  createdAt: string;
}
