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
