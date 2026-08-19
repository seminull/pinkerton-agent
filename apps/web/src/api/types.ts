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
  communications?: Communication[];
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

export type CommunicationChannel = "sms" | "call" | "email";
export type CommunicationDirection = "incoming" | "outgoing";

export interface Communication {
  id: string;
  contactId: string;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  occurredAt: string;
  body: string | null;
  counterpartyAddress: string;
  durationSeconds: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListResponse<T> {
  results: T[];
  total: number;
}

// --- MLS feed -------------------------------------------------------------
// These come from the MLS via Bridge, not from our database, so they carry RESO
// Data Dictionary semantics rather than our column names. Nothing here has an
// `id` — `listingKey` is the MLS's immutable identifier and the only safe key
// to sync on. (`listingId` is the human-facing MLS number, and it can change.)

export interface MlsListing {
  listingKey: string;
  listingId: string | null;
  status: string | null;
  /** Converted from RESO's dollar amount by the API, to match our cents rule. */
  listPriceCents: number | null;
  /** The dollars Bridge actually sent, kept so the conversion stays visible. */
  listPriceDollars: number | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  county: string | null;
  /** The join key to Big District's appraisal data. Fill rate varies by MLS. */
  parcelNumber: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  livingAreaSqft: number | null;
  yearBuilt: number | null;
  propertyType: string | null;
  modificationTimestamp: string | null;
  photosCount: number | null;
}

export interface MlsStatus {
  base: string;
  dataset: string;
  /** Using the shared public token rather than our own credential. */
  isDemoToken: boolean;
  /** The records are synthetic. Independent of the token — see bridgeConfig. */
  isDemoData: boolean;
  tokenHint: string;
  targetCounties: string[];
  reachable: boolean;
  error: string | null;
}

/** The OData the API generated, echoed back so the UI can show it. */
export interface MlsQueryEcho {
  filter: string;
  orderby: string;
  url: string;
}

export interface MlsSearchResponse {
  results: MlsListing[];
  total: number;
  query: MlsQueryEcho;
}

export interface MlsFieldCoverage {
  name: string;
  filled: number;
  percent: number;
  example: string | null;
}

export interface MlsCoverageResponse {
  sample: number;
  fields: MlsFieldCoverage[];
}
