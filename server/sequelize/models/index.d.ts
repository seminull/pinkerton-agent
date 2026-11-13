// Hand-written types for the CommonJS model registry in index.js. The
// sequelize-cli scaffold is plain JS, so this is what gives the TypeScript
// routes real types for `Contact`, `Listing`, and friends. Add a model here
// whenever you add one to models/.
import type { Model, ModelStatic, Sequelize } from "sequelize";

export interface ContactAttributes {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  /** buyer | seller | both — which side of a transaction this person is on. */
  type: string;
  /** new | contacted | qualified | active | closed | lost */
  stage: string;
  /** Free-text provenance: "Zillow", "referral — J. Kim", "open house 4/12". */
  source: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListingAttributes {
  id: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  /** Multiple Listing Service number, once the listing is actually on the MLS. */
  mlsNumber: string | null;
  /** draft | coming_soon | active | pending | sold | withdrawn | expired */
  status: string;
  /** sale | lease — determines whether listPriceCents is a price or monthly rent. */
  listingType: string;
  /** Stored in cents. Never float — money and binary floating point don't mix. */
  listPriceCents: number | null;
  bedrooms: number | null;
  /** DECIMAL so half-baths ("2.5") survive the round trip. */
  bathrooms: string | null;
  livingAreaSqft: number | null;
  lotAcres: string | null;
  yearBuilt: number | null;
  parcelNumber: string | null;
  listedOn: string | null;
  /** The seller. Nullable so a listing can be drafted before it has a contact. */
  sellerContactId: string | null;
  /** Public portals and working records associated with this property. */
  externalLinks: { label: string; url: string }[];
  notes: string | null;
  /** Soft-delete timestamp. Normal Listing queries exclude rows where it is set. */
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActivityAttributes {
  id: string;
  /** call | email | text | meeting | showing | note | task */
  type: string;
  subject: string;
  body: string | null;
  /** When it happened, or when it's due for an unfinished task. */
  occurredAt: Date;
  completedAt: Date | null;
  contactId: string | null;
  listingId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListingPhotoAttributes {
  id: string;
  listingId: string;
  /** Opaque server-generated filename; never exposed in the API response. */
  storageKey: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserAttributes {
  id: string;
  /** Always lowercased and trimmed. */
  email: string;
  /** NULL for an account that only signs in through a provider. */
  passwordHash: string | null;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  /** user | admin */
  role: string;
  /** active | disabled */
  status: string;
  /** Set only once a provider has vouched for the address. */
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthIdentityAttributes {
  id: string;
  userId: string;
  /** google */
  provider: string;
  /** The provider's stable subject id — the real key, not the email. */
  providerUserId: string;
  providerEmail: string | null;
  profile: Record<string, unknown>;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserSessionAttributes {
  id: string;
  userId: string;
  /** SHA-256 hex of the cookie token. The token itself is never stored. */
  tokenHash: string;
  userAgent: string | null;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TimeEntryAttributes {
  id: string;
  /** Whose time this is. Every query is scoped by it. */
  userId: string;
  category: string;
  task: string;
  /** An anonymous label ("File A"), not a client name. */
  reference: string | null;
  workType: string;
  notes: string | null;
  startedAt: Date;
  /** NULL while the task is still running. */
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TimeShareAttributes {
  id: string;
  userId: string;
  /** SHA-256 hex of the public URL token. The token itself is never stored. */
  tokenHash: string;
  /** calendar | day */
  scope: string;
  /** Restricted day, or the initially selected day for a calendar share. */
  day: string;
  /** IANA time zone that defines the share's local calendar dates. */
  timeZone: string;
  /** Owner's note for telling links apart; the URL can't be shown again. */
  label: string | null;
  /** Set = removed. The link stops working; its access log is kept. */
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TimeShareAccessAttributes {
  id: string;
  timeShareId: string;
  /** The visitor's address as reported by the proxy, or the socket's. */
  ipAddress: string | null;
  userAgent: string | null;
  /** share | entries | daily | summary */
  resource: string;
  /** The day or day range requested, when the endpoint takes one. */
  detail: string | null;
  /** allowed | revoked | owner_disabled */
  outcome: string;
  createdAt: Date;
}

interface TimeOptionBase {
  id: string;
  userId: string;
  /** Unique per user. Entries store this text, so a rename updates them too. */
  name: string;
  /** Order in the dropdown. */
  position: number;
  /** Set = hidden from the dropdowns, kept for past entries. */
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TimeCategoryAttributes extends TimeOptionBase {
  /** Break time is reported separately and left out of work time. */
  isBreak: boolean;
}

export interface TimeWorkTypeAttributes extends TimeOptionBase {
  /** False for work someone else did: tracked, but not the user's own time. */
  countsAsOwnTime: boolean;
}

// Columns the database or Sequelize fills in, so `create()` doesn't demand them.
type Generated = "id" | "createdAt" | "updatedAt";

export type ContactInstance = Model<ContactAttributes> & ContactAttributes;
export type ListingInstance = Model<ListingAttributes> & ListingAttributes;
export type ActivityInstance = Model<ActivityAttributes> & ActivityAttributes;
export type ListingPhotoInstance = Model<
  ListingPhotoAttributes,
  Omit<ListingPhotoAttributes, Generated>
> &
  ListingPhotoAttributes;

export type UserInstance = Model<UserAttributes, Omit<UserAttributes, Generated>> &
  UserAttributes;
export type AuthIdentityInstance = Model<
  AuthIdentityAttributes,
  Omit<AuthIdentityAttributes, Generated>
> &
  AuthIdentityAttributes;
export type UserSessionInstance = Model<
  UserSessionAttributes,
  Omit<UserSessionAttributes, Generated>
> &
  UserSessionAttributes;

export type TimeEntryInstance = Model<
  TimeEntryAttributes,
  Omit<TimeEntryAttributes, Generated>
> &
  TimeEntryAttributes;

export type TimeShareInstance = Model<
  TimeShareAttributes,
  Omit<TimeShareAttributes, Generated>
> &
  TimeShareAttributes;

export type TimeShareAccessInstance = Model<
  TimeShareAccessAttributes,
  Omit<TimeShareAccessAttributes, "id" | "createdAt">
> &
  TimeShareAccessAttributes;

export type TimeCategoryInstance = Model<
  TimeCategoryAttributes,
  Omit<TimeCategoryAttributes, Generated>
> &
  TimeCategoryAttributes;
export type TimeWorkTypeInstance = Model<
  TimeWorkTypeAttributes,
  Omit<TimeWorkTypeAttributes, Generated>
> &
  TimeWorkTypeAttributes;

export const sequelize: Sequelize;
export const Contact: ModelStatic<ContactInstance>;
export const Listing: ModelStatic<ListingInstance>;
export const Activity: ModelStatic<ActivityInstance>;
export const ListingPhoto: ModelStatic<ListingPhotoInstance>;
export const User: ModelStatic<UserInstance>;
export const AuthIdentity: ModelStatic<AuthIdentityInstance>;
export const UserSession: ModelStatic<UserSessionInstance>;
export const TimeEntry: ModelStatic<TimeEntryInstance>;
export const TimeShare: ModelStatic<TimeShareInstance>;
export const TimeShareAccess: ModelStatic<TimeShareAccessInstance>;
export const TimeCategory: ModelStatic<TimeCategoryInstance>;
export const TimeWorkType: ModelStatic<TimeWorkTypeInstance>;
