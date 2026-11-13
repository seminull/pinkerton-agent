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

/** GET /api/time-entries/summary — whole minutes, over completed entries. */
export interface TimeSummary {
  /** Everything that is neither a break nor assistant-performed work. */
  workMinutes: number;
  breakMinutes: number;
  /** Work the assistant did — tracked, but not the user's own time. */
  assistantMinutes: number;
  entryCount: number;
}

/** One day's totals from GET /api/time-entries/daily. */
export interface TimeDayTotals extends TimeSummary {
  /** The local calendar day, YYYY-MM-DD, in the zone the request named. */
  day: string;
}

/**
 * A Time Clock category or work type, as the Setup tab sees it. A category
 * carries `isBreak`; a work type carries `countsAsOwnTime`.
 */
export interface TimeOption {
  id: string;
  name: string;
  /** Hidden from the dropdowns, kept because past entries use it. */
  archived: boolean;
  /** How many of the user's entries use this name. 0 = safe to delete. */
  entryCount: number;
  isBreak?: boolean;
  countsAsOwnTime?: boolean;
}

/** POST /api/time-entries/import */
export interface TimeImportResult {
  imported: number;
  /** Rows skipped because an identical entry already existed. */
  duplicates: number;
  /** Names added to the user's Setup lists because the file used them. */
  createdCategories: string[];
  createdWorkTypes: string[];
}
