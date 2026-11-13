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

/**
 * POST /api/listings/lookup — a listing link looked up in BigDistrict, shaped
 * as a draft listing for the form to open with.
 */
export interface ListingLookup {
  /**
   * matched   — the home was found in the county records
   * ambiguous — more than one home fits the address; none was chosen
   * not_found — not in the records (usually: outside BigDistrict's counties)
   */
  status: "matched" | "ambiguous" | "not_found";
  /** How sure a match is. `approximate` deserves a look at the address. */
  quality: "exact" | "approximate" | null;
  /** Never includes a price or status — only the listing site knows those. */
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
  };
  county: string | null;
  bigDistrictUrl: string | null;
  /** The submitted link with its query string removed. */
  zillowUrl: string;
  candidates: number;
}

/**
 * One of the caller's share links on the Shared links tab, with its usage
 * rolled up. The token is absent by design: only its hash exists.
 */
export interface TimeShareSummary {
  id: string;
  scope: "calendar" | "day";
  day: string;
  timeZone: string;
  label: string | null;
  /** Derived from revokedAt, so the client never re-implements the rule. */
  status: "active" | "removed";
  revokedAt: Date | null;
  createdAt: Date;
  /** Allowed page opens: the metadata request a viewer's first load makes. */
  openCount: number;
  /** Every allowed request, including each day and month looked at. */
  requestCount: number;
  uniqueIpCount: number;
  lastAccessedAt: Date | null;
  /** Requests refused because the link was removed or its owner disabled. */
  blockedCount: number;
}

/** One row of a share link's access log. */
export interface TimeShareAccessRecord {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  resource: "share" | "entries" | "daily" | "summary";
  detail: string | null;
  outcome: "allowed" | "revoked" | "owner_disabled";
  createdAt: Date;
}

/** GET /api/dashboard — everything the dashboard draws, pre-aggregated. */
export interface DashboardData {
  tiles: {
    contactCount: number;
    activeListingCount: number;
    /** BIGINT cents as a string; the client converts at the edge. */
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
