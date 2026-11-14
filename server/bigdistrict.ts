import { apiError } from "./http";
import type { ListingLookup } from "./types";

// The BigDistrict integration: asking the property-records app "which home is
// this listing link about, and what do the county records say about it?"
//
// Why it goes through BigDistrict at all: this app deliberately does no
// scraping, and neither does BigDistrict — nothing is ever fetched from the
// listing site. BigDistrict reads the address out of the text of the link and
// matches it to the appraisal roll it already holds. So what comes back is what
// the county knows (address, beds, baths, living area, lot, year built), and
// never what only the listing knows (price, photos, description, status).
//
// BigDistrict logs and stores every request on its side (its
// docs/INTEGRATIONS.md); this module keeps nothing.

// Both from the environment. The URL has a default because there is one
// BigDistrict; the key does not, because without one the feature is simply off.
const baseUrl = (): string =>
  (process.env.BIGDISTRICT_API_URL?.trim() || "https://bigdistrict.app").replace(/\/$/, "");
const apiKey = (): string | null => process.env.BIGDISTRICT_API_KEY?.trim() || null;

export interface BigDistrictPropertyAddress {
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode: string;
}

/** Whether the unified URL lookup can handle Zillow links. */
export const bigDistrictConfigured = (): boolean => apiKey() !== null;

// A person is watching a spinner; BigDistrict answers in well under a second
// when it is healthy. Long enough for a slow day, short enough to fail visibly.
const TIMEOUT_MS = 8000;

// The parts of BigDistrict's answer this app reads. Everything is optional on
// purpose: it is another service's response, and a missing field should
// degrade to "blank in the form", not throw.
interface BigDistrictAnswer {
  status?: string;
  candidates?: number;
  parsed?: {
    address?: string | null;
    line1?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
  };
  match?: {
    quality?: string;
    county?: string | null;
    url?: string | null;
    address?: {
      line1?: string | null;
      city?: string | null;
      state?: string | null;
      postalCode?: string | null;
    };
    bedrooms?: number | null;
    bathrooms?: number | null;
    livingAreaSqft?: number | null;
    lotAcres?: number | null;
    yearBuilt?: number | null;
  } | null;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

// The link as it will be kept in the listing's external-links collection:
// origin and path only.
// Share links carry tracking parameters, and those have no business being
// stored against a listing.
const cleanLink = (raw: string): string => {
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return `${url.origin}${url.pathname}`;
  } catch {
    return raw;
  }
};

/**
 * Look a listing link up in BigDistrict and turn the answer into a draft
 * listing. Throws an apiError for every failure a person can act on.
 *
 * @param requestedBy this app's id for the signed-in user — sent so
 *   BigDistrict's request log can tell who asked, without it holding an email.
 */
export const lookupListing = async (url: string, requestedBy: string): Promise<ListingLookup> => {
  const key = apiKey();
  if (!key) throw apiError(503, "listing_lookup_not_configured");

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}/api/integrations/listing-lookup`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ url, requestedBy }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    console.error("BigDistrict listing lookup: request failed:", err);
    throw apiError(502, "listing_lookup_unavailable");
  }

  // The one failure that is about the link itself, not the plumbing.
  if (response.status === 422) throw apiError(422, "unsupported_listing_url");
  if (response.status === 429) throw apiError(429, "listing_lookup_busy");
  if (!response.ok) {
    // 401 (our key is wrong) and 503 (BigDistrict has no key configured, or its
    // search is down) are operator problems. Logged with the status so they can
    // be told apart here; the person at the keyboard just sees "unavailable".
    console.error(`BigDistrict listing lookup: answered ${response.status}`);
    throw apiError(502, "listing_lookup_unavailable");
  }

  const answer = (await response.json().catch(() => null)) as BigDistrictAnswer | null;
  if (!answer || typeof answer !== "object") throw apiError(502, "listing_lookup_unavailable");

  const zillowUrl = cleanLink(url);
  const match = answer.status === "matched" ? answer.match : null;

  if (match) {
    const bigDistrictUrl = text(match.url) || null;
    return {
      source: "zillow",
      status: "matched",
      quality: match.quality === "exact" ? "exact" : "approximate",
      draft: {
        addressLine1: text(match.address?.line1),
        city: text(match.address?.city),
        state: text(match.address?.state) || "TX",
        postalCode: text(match.address?.postalCode),
        // The roll stores counts as decimals (4.0) and areas with fractions
        // (2812.5); the listing columns are whole numbers.
        bedrooms: count(match.bedrooms) === null ? null : Math.round(match.bedrooms!),
        bathrooms: count(match.bathrooms),
        livingAreaSqft: count(match.livingAreaSqft) === null ? null : Math.round(match.livingAreaSqft!),
        lotAcres: count(match.lotAcres),
        yearBuilt: count(match.yearBuilt),
        notes: "",
        mlsNumber: null,
        status: null,
        listingType: "sale",
        listPriceCents: null,
        parcelNumber: null,
      },
      county: text(match.county) || null,
      bigDistrictUrl,
      sourceUrl: zillowUrl,
      candidates: 1,
      photoCount: 0,
    };
  }

  // No single parcel: outside BigDistrict's counties, or more than one home
  // fits. The link's own address is still worth pre-filling. When BigDistrict
  // couldn't tell where the street ends and the city begins, both arrive
  // together and go in the street field for the person to split.
  const parsed = answer.parsed ?? {};
  return {
    source: "zillow",
    status: answer.status === "ambiguous" ? "ambiguous" : "not_found",
    quality: null,
    draft: {
      addressLine1: text(parsed.line1) || text(parsed.address),
      city: text(parsed.city),
      state: text(parsed.state) || "TX",
      postalCode: text(parsed.postalCode),
      bedrooms: null,
      bathrooms: null,
      livingAreaSqft: null,
      lotAcres: null,
      yearBuilt: null,
      notes: "",
      mlsNumber: null,
      status: null,
      listingType: "sale",
      listPriceCents: null,
      parcelNumber: null,
    },
    county: null,
    bigDistrictUrl: null,
    sourceUrl: zillowUrl,
    candidates: typeof answer.candidates === "number" ? answer.candidates : 0,
    photoCount: 0,
  };
};

const fullAddress = (address: BigDistrictPropertyAddress): string =>
  [
    address.addressLine1.trim(),
    address.addressLine2?.trim(),
    address.city.trim(),
    `${address.state.trim()} ${address.postalCode.trim()}`.trim(),
  ]
    .filter(Boolean)
    .join(", ");

/** A useful BigDistrict destination even when an exact parcel cannot be resolved. */
export const bigDistrictSearchUrl = (address: BigDistrictPropertyAddress): string => {
  const url = new URL("/properties", `${baseUrl()}/`);
  url.searchParams.set("q", fullAddress(address));
  return url.toString();
};

/** Whether a stored external link belongs to BigDistrict. */
export const isBigDistrictUrl = (raw: string): boolean => {
  try {
    const url = new URL(raw);
    const configuredHost = new URL(`${baseUrl()}/`).hostname.toLowerCase();
    const hostname = url.hostname.toLowerCase();
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      ["bigdistrict.app", configuredHost].some(
        (host) => hostname === host || hostname.endsWith(`.${host}`)
      )
    );
  } catch {
    return false;
  }
};

// BigDistrict's listing integration deliberately parses the address from a
// Zillow-style URL without fetching Zillow. This gives it the same input for a
// manually-created property as it gets from the Add with URL workflow.
const addressLookupUrl = (address: BigDistrictPropertyAddress): string => {
  const slug = [
    address.addressLine1,
    address.addressLine2,
    address.city,
    address.state,
    address.postalCode.slice(0, 5),
  ]
    .filter(Boolean)
    .join("-")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "");
  return `https://www.zillow.com/homes/${slug}_rb/`;
};

/**
 * Resolve a property to its exact BigDistrict parcel page when possible. A
 * search link is always returned, so a BigDistrict outage or an uncovered
 * county never prevents saving or opening a property in this app.
 */
export const resolveBigDistrictPropertyUrl = async (
  address: BigDistrictPropertyAddress,
  requestedBy: string
): Promise<string> => {
  const fallback = bigDistrictSearchUrl(address);
  if (!bigDistrictConfigured()) return fallback;

  try {
    const lookup = await lookupListing(addressLookupUrl(address), requestedBy);
    return lookup.bigDistrictUrl || fallback;
  } catch (error) {
    console.error("BigDistrict property-link resolution failed:", error);
    return fallback;
  }
};
