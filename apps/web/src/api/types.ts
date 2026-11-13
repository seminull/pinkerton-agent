// The shapes the API actually returns. Note where these differ from the
// database columns: timestamps arrive as ISO strings, and Postgres DECIMAL
// columns (bathrooms, lotAcres) come back as strings because pg refuses to
// silently narrow them to a float.

export type ContactType = "buyer" | "seller" | "both";
export type ContactStage =
  | "new"
  | "contacted"
  | "qualified"
  | "active"
  | "closed"
  | "lost";

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  type: ContactType;
  stage: ContactStage;
  source: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  listings?: Listing[];
}

export type ListingStatus =
  | "draft"
  | "coming_soon"
  | "active"
  | "pending"
  | "sold"
  | "withdrawn"
  | "expired";

export interface Listing {
  id: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  mlsNumber: string | null;
  status: ListingStatus;
  /** Cents. BIGINT, so it arrives as a string once it exceeds 2^53. */
  listPriceCents: string | number | null;
  bedrooms: number | null;
  bathrooms: string | null;
  livingAreaSqft: number | null;
  lotAcres: string | null;
  yearBuilt: number | null;
  listedOn: string | null;
  sellerContactId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  seller?: Contact | null;
}

export type ActivityType =
  | "call"
  | "email"
  | "text"
  | "meeting"
  | "showing"
  | "note"
  | "task";

export interface Activity {
  id: string;
  type: ActivityType;
  subject: string;
  body: string | null;
  occurredAt: string;
  completedAt: string | null;
  contactId: string | null;
  listingId: string | null;
  createdAt: string;
  updatedAt: string;
  contact?: Contact | null;
  listing?: Listing | null;
}

export interface ListResponse<T> {
  results: T[];
  total: number;
}

/** The signed-in user. Mirrors `AuthUser` in server/types.ts. */
export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  role: "user" | "admin";
}

/** GET /api/auth/me — `user` is null when nobody is signed in. */
export interface AuthStatus {
  user: AuthUser | null;
  /** Which sign-in buttons the server can actually honour. */
  providers: { google: boolean };
}

/** An account as the admin Users screen sees it. Mirrors server/types.ts. */
export interface AdminUser extends AuthUser {
  status: "active" | "disabled";
  /** True once a provider has vouched for the address (a Google sign-in). */
  emailVerified: boolean;
  hasPassword: boolean;
  /** Linked sign-in providers, e.g. ["google"]. */
  providers: string[];
  lastLoginAt: string | null;
  createdAt: string;
}

/** One timed task on the Time Clock. `endedAt` is null while it is running. */
export interface TimeEntry {
  id: string;
  category: string;
  task: string;
  reference: string | null;
  workType: string;
  notes: string | null;
  startedAt: string;
  endedAt: string | null;
}

/** GET /api/time-entries/summary — whole minutes, over completed entries. */
export interface TimeSummary {
  workMinutes: number;
  breakMinutes: number;
  /** Work the assistant did — tracked, but not the user's own time. */
  assistantMinutes: number;
  entryCount: number;
}

/** One day's totals from GET /api/time-entries/daily. */
export interface TimeDayTotals extends TimeSummary {
  /** The local calendar day, YYYY-MM-DD. */
  day: string;
}

/**
 * A Time Clock category or work type (the Setup tab). A category carries
 * `isBreak`; a work type carries `countsAsOwnTime`.
 */
export interface TimeOption {
  id: string;
  name: string;
  /** Hidden from the dropdowns, kept because past entries use it. */
  archived: boolean;
  /** How many of your entries use this name. 0 = safe to delete. */
  entryCount: number;
  isBreak?: boolean;
  countsAsOwnTime?: boolean;
}

/** GET /api/time-options */
export interface TimeOptions {
  categories: TimeOption[];
  workTypes: TimeOption[];
}
