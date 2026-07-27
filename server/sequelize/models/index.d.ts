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
  /** Stored in cents. Never float — money and binary floating point don't mix. */
  listPriceCents: number | null;
  bedrooms: number | null;
  /** DECIMAL so half-baths ("2.5") survive the round trip. */
  bathrooms: string | null;
  livingAreaSqft: number | null;
  lotAcres: string | null;
  yearBuilt: number | null;
  listedOn: string | null;
  /** The seller. Nullable so a listing can be drafted before it has a contact. */
  sellerContactId: string | null;
  notes: string | null;
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

export type ContactInstance = Model<ContactAttributes> & ContactAttributes;
export type ListingInstance = Model<ListingAttributes> & ListingAttributes;
export type ActivityInstance = Model<ActivityAttributes> & ActivityAttributes;

export const sequelize: Sequelize;
export const Contact: ModelStatic<ContactInstance>;
export const Listing: ModelStatic<ListingInstance>;
export const Activity: ModelStatic<ActivityInstance>;
