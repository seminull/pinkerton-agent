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

export type ListingType = "sale" | "lease";

export interface ExternalLink {
  label: string;
  url: string;
}

export interface Listing {
  id: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  mlsNumber: string | null;
  status: ListingStatus;
  listingType: ListingType;
  /** Cents. BIGINT, so it arrives as a string once it exceeds 2^53. */
  listPriceCents: string | number | null;
  bedrooms: number | null;
  bathrooms: string | null;
  livingAreaSqft: number | null;
  lotAcres: string | null;
  yearBuilt: number | null;
  parcelNumber: string | null;
  listedOn: string | null;
  sellerContactId: string | null;
  externalLinks: ExternalLink[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  seller?: Contact | null;
}

export interface ListingPhoto {
  id: string;
  listingId: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  position: number;
  createdAt: string;
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

export type TimeShareScope = "calendar" | "day";

/** Public metadata for a read-only Time Clock capability link. */
export interface TimeShare {
  scope: TimeShareScope;
  /** Fixed day, or the initially selected day for a calendar share. */
  day: string;
  /** The owner's IANA zone; it defines dates and displayed clock times. */
  timeZone: string;
  createdAt: string;
}

export type TimeShareStatus = "active" | "removed";

/**
 * One of your own share links on the Shared links tab, with usage rolled up.
 * There is no token: only its hash is stored, so a link can't be shown again.
 */
export interface TimeShareSummary {
  id: string;
  scope: TimeShareScope;
  day: string;
  timeZone: string;
  label: string | null;
  status: TimeShareStatus;
  revokedAt: string | null;
  createdAt: string;
  /** Allowed page opens. */
  openCount: number;
  /** Every allowed request, including each day and month viewed. */
  requestCount: number;
  uniqueIpCount: number;
  lastAccessedAt: string | null;
  /** Requests refused after removal (or with the owner disabled). */
  blockedCount: number;
}

/** One row of a share link's access log. */
export interface TimeShareAccess {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  resource: "share" | "entries" | "daily" | "summary";
  /** The day (YYYY-MM-DD) or range (from..to) requested, when there was one. */
  detail: string | null;
  outcome: "allowed" | "revoked" | "owner_disabled";
  createdAt: string;
}

/** A public entry. File references are omitted at the API boundary. */
export interface SharedTimeEntry {
  id: string;
  category: string;
  task: string;
  workType: string;
  notes: string | null;
  startedAt: string;
  endedAt: string;
  kind: "work" | "break" | "assistant";
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

/** POST /api/time-entries/import */
export interface TimeImportResult {
  imported: number;
  /** Rows skipped because an identical entry already existed. */
  duplicates: number;
  /** Names added to your Setup lists because the file used them. */
  createdCategories: string[];
  createdWorkTypes: string[];
}

/** A Zillow/county or Matrix result that pre-fills a new listing form. */
export interface ListingLookup {
  source: "zillow" | "matrix";
  /** matched = found in county records; otherwise only the address is known. */
  status: "matched" | "ambiguous" | "not_found";
  /** How sure a match is. `approximate` deserves a look at the address. */
  quality: "exact" | "approximate" | null;
  draft: {
    addressLine1: string;
    city: string;
    state: string;
    postalCode: string;
    bedrooms: number | null;
    bathrooms: number | null;
    livingAreaSqft: number | null;
    lotAcres: number | null;
    yearBuilt: number | null;
    notes: string;
    mlsNumber: string | null;
    status: ListingStatus | null;
    listingType: ListingType;
    listPriceCents: number | null;
    parcelNumber: string | null;
  };
  county: string | null;
  bigDistrictUrl: string | null;
  sourceUrl: string;
  candidates: number;
  photoCount: number;
}

/** GET /api/dashboard — everything the dashboard draws, pre-aggregated. */
export interface DashboardData {
  tiles: {
    contactCount: number;
    activeListingCount: number;
    /** BIGINT cents as a string; convert with formatPriceCents. */
    activeVolumeCents: string;
    /** Open activities whose time has already passed. */
    overdueFollowUps: number;
    /** Open activities due in the next seven days. */
    dueThisWeek: number;
  };
  /** Every stage, in pipeline order, including empty ones. */
  pipeline: { stage: string; count: number }[];
  /** New contacts per local month (YYYY-MM), oldest first, by contact type. */
  leadsByMonth: { month: string; buyer: number; seller: number; both: number }[];
  /** Completed client touchpoints per week; `week` is its Monday, YYYY-MM-DD. */
  touchpointsByWeek: {
    week: string;
    calls: number;
    /** Texts and emails together. */
    messages: number;
    showings: number;
    meetings: number;
  }[];
  /** Contacts from the last 12 months by source, top few plus "Other". */
  leadSources: { source: string; contacts: number; closed: number }[];
  /** Active listings, longest on market first. */
  daysOnMarket: {
    id: string;
    address: string;
    city: string;
    days: number;
    listPriceCents: string | null;
  }[];
}
