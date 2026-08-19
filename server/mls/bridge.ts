// Bridge Data Output (a Zillow Group company) RESO Web API client.
//
// Bridge is a distribution hub, not the data owner. The MLS still licenses the
// data and approves each feed individually, so until NTREIS approves ours this
// runs against Bridge's public `test` dataset: synthetic records carrying the
// real RESO Data Dictionary field surface. Building against it now means going
// live is a change to BRIDGE_DATASET and BRIDGE_TOKEN and nothing else.
//
// The token never reaches the browser. The client calls /api/mls/*, and this
// module calls Bridge. A server token shipped in frontend JavaScript is a token
// anyone can lift out of devtools and spend our rate limit — or our license —
// on.

import { apiError } from "../http";

// Bridge documents this token publicly for the `test` dataset. It unlocks
// nothing but synthetic data, so it ships as the zero-config default and the
// Test tab works on a fresh clone. Real credentials go in .env, never in git.
const PUBLIC_DEMO_TOKEN = "6baca547742c6f96a6ff71b138424f21";

const DEFAULT_BASE = "https://api.bridgedataoutput.com/api/v2/OData";
const DEFAULT_DATASET = "test";

// A hung upstream must not hold an API worker open indefinitely. Bridge is
// normally sub-second; 15s is a generous ceiling that still fails visibly.
const REQUEST_TIMEOUT_MS = 15_000;

// Bridge caps $top at 1000 regardless of what we ask for. Stating it here means
// a caller that asks for more gets a clamped page instead of a silent 400.
const MAX_TOP = 1000;

export interface BridgeConfig {
  base: string;
  dataset: string;
  token: string;
  /** Running on the shared public token rather than our own credential. */
  isDemoToken: boolean;
  /**
   * The records are synthetic. This keys off the *dataset*, not the token,
   * because those two are independent: pointing your own approved server token
   * at `test` still returns generated data. Deciding "is this real?" from the
   * token would drop the warning banner the moment a real credential is pasted
   * in, which is exactly when it's most misleading.
   */
  isDemoData: boolean;
}

export const bridgeConfig = (): BridgeConfig => {
  const token = process.env.BRIDGE_TOKEN?.trim() || PUBLIC_DEMO_TOKEN;
  const dataset = process.env.BRIDGE_DATASET?.trim() || DEFAULT_DATASET;
  return {
    base: process.env.BRIDGE_BASE?.trim() || DEFAULT_BASE,
    dataset,
    token,
    isDemoToken: token === PUBLIC_DEMO_TOKEN,
    isDemoData: dataset === DEFAULT_DATASET,
  };
};

// The four counties Big District already has appraisal data for. A listing
// outside these has no CAD enrichment available, which is why the explorer
// filters on them by default rather than pulling all of NTREIS's ~48,000 sq mi.
export const TARGET_COUNTIES = ["Collin", "Dallas", "Denton", "Tarrant"] as const;

// OData escapes a single quote by doubling it. Skipping this doesn't just break
// on "Stephon O'Hara Plc" — an unescaped quote lets a search box terminate the
// literal and append its own filter logic.
const odataString = (value: string): string => `'${value.replace(/'/g, "''")}'`;

// Filterable fields, by the query param the client is allowed to send. Same
// rule as WRITABLE in the route files: a caller can only filter on a field this
// list opts into, so no amount of query-string creativity reaches an arbitrary
// RESO column.
type FilterBuilder = (value: string) => string | null;

const FILTERS: Record<string, FilterBuilder> = {
  status: (v) => `StandardStatus eq ${odataString(v)}`,
  propertyType: (v) => `PropertyType eq ${odataString(v)}`,
  city: (v) => `City eq ${odataString(v)}`,
  state: (v) => `StateOrProvince eq ${odataString(v)}`,
  postalCode: (v) => `PostalCode eq ${odataString(v)}`,
  // ListPrice is dollars in RESO. The cents conversion happens on the way out
  // (see toMlsListing) — sending cents here would filter against the wrong
  // magnitude and silently return nothing.
  minPrice: (v) => (Number.isFinite(Number(v)) ? `ListPrice ge ${Number(v)}` : null),
  maxPrice: (v) => (Number.isFinite(Number(v)) ? `ListPrice le ${Number(v)}` : null),
  minBeds: (v) =>
    Number.isFinite(Number(v)) ? `BedroomsTotal ge ${Number(v)}` : null,
  minBaths: (v) =>
    Number.isFinite(Number(v)) ? `BathroomsTotalInteger ge ${Number(v)}` : null,
  minYearBuilt: (v) => (Number.isFinite(Number(v)) ? `YearBuilt ge ${Number(v)}` : null),
  // The replication watermark. An incremental sync is this filter plus an
  // orderby on the same column — everything else here is exploration.
  modifiedSince: (v) =>
    Number.isNaN(Date.parse(v))
      ? null
      : `ModificationTimestamp gt ${new Date(v).toISOString()}`,
  // Comma-separated, OR-ed together, because "my four counties" is one filter
  // conceptually even though OData needs it spelled out.
  counties: (v) => {
    const names = v
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    if (names.length === 0) return null;
    return `(${names.map((n) => `CountyOrParish eq ${odataString(n)}`).join(" or ")})`;
  },
};

// Sortable columns, allowlisted for the same reason SORT_FIELDS is in the route
// files: an arbitrary $orderby is a way to probe fields the feed shouldn't hand
// back, and a typo'd one is a 400 from Bridge rather than a useful default.
export const SORT_FIELDS: Record<string, string> = {
  ListPrice: "ListPrice",
  ModificationTimestamp: "ModificationTimestamp",
  YearBuilt: "YearBuilt",
  LivingArea: "LivingArea",
  BedroomsTotal: "BedroomsTotal",
};

// The columns the explorer reads. $select keeps the payload to something a
// browser table can hold — an unnarrowed Property row is 620 fields on Bridge's
// demo dataset, ~60% of them null, and pulling all of that for a 25-row page
// wastes both quota and render time. The raw-record view drops $select on
// purpose, because there the point *is* to see everything.
const SELECT_FIELDS = [
  "ListingKey",
  "ListingId",
  "StandardStatus",
  "ListPrice",
  "UnparsedAddress",
  "City",
  "StateOrProvince",
  "PostalCode",
  "CountyOrParish",
  // The Big District join key. Carried from day one because retrofitting it
  // means fuzzy-matching addresses against a CAD, which is miserable.
  "ParcelNumber",
  "BedroomsTotal",
  "BathroomsTotalInteger",
  "LivingArea",
  "YearBuilt",
  "PropertyType",
  "ModificationTimestamp",
  "PhotosCount",
] as const;

/** A Bridge Property row, narrowed to what the explorer displays. */
export interface MlsListing {
  listingKey: string;
  listingId: string | null;
  status: string | null;
  /** Converted at this boundary so the rest of the app keeps its cents rule. */
  listPriceCents: number | null;
  /** What Bridge actually sent, in dollars. Shown so the conversion is visible. */
  listPriceDollars: number | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  county: string | null;
  parcelNumber: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  livingAreaSqft: number | null;
  yearBuilt: number | null;
  propertyType: string | null;
  modificationTimestamp: string | null;
  photosCount: number | null;
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const str = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

export const toMlsListing = (row: Record<string, unknown>): MlsListing => {
  const dollars = num(row.ListPrice);
  return {
    listingKey: String(row.ListingKey ?? ""),
    listingId: str(row.ListingId),
    status: str(row.StandardStatus),
    // RESO ListPrice is a decimal dollar amount; this repo stores integer cents
    // everywhere. Rounding rather than truncating matches dollarsToCents on the
    // client, so a price never drifts a cent depending on which side converted.
    listPriceCents: dollars === null ? null : Math.round(dollars * 100),
    listPriceDollars: dollars,
    address: str(row.UnparsedAddress),
    city: str(row.City),
    state: str(row.StateOrProvince),
    postalCode: str(row.PostalCode),
    county: str(row.CountyOrParish),
    parcelNumber: str(row.ParcelNumber),
    bedrooms: num(row.BedroomsTotal),
    bathrooms: num(row.BathroomsTotalInteger),
    livingAreaSqft: num(row.LivingArea),
    yearBuilt: num(row.YearBuilt),
    propertyType: str(row.PropertyType),
    modificationTimestamp: str(row.ModificationTimestamp),
    photosCount: num(row.PhotosCount),
  };
};

export interface ODataResponse {
  value: Record<string, unknown>[];
  "@odata.count"?: number;
  "@odata.nextLink"?: string;
}

/**
 * Issue one OData request. `params` are OData system query options ($filter,
 * $top, ...) already assembled by the caller.
 */
export const bridgeQuery = async (
  resource: string,
  params: Record<string, string | undefined>
): Promise<{ data: ODataResponse; url: string }> => {
  const config = bridgeConfig();
  const search = new URLSearchParams({ access_token: config.token });
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, value);
  }

  const url = `${config.base}/${config.dataset}/${resource}?${search}`;

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    // Bridge being unreachable is an upstream outage, not a bug in this app —
    // 502 so the UI can say "the feed is down" rather than "something broke".
    console.error("bridge request failed:", err);
    throw apiError(502, "mls_upstream_unreachable");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`bridge ${res.status} for ${resource}:`, body.slice(0, 500));
    // 401 means the token is missing, wrong, or not approved for this dataset —
    // by far the most common failure here, and worth its own code so the UI can
    // point at the credentials instead of at the network.
    if (res.status === 401 || res.status === 403) {
      throw apiError(502, "mls_not_authorized");
    }
    if (res.status === 429) throw apiError(502, "mls_rate_limited");
    throw apiError(502, "mls_upstream_error", { status: String(res.status) });
  }

  const data = (await res.json()) as ODataResponse;
  // Echo the URL back with the token stripped so the UI can show the exact
  // OData that ran. Seeing the query is most of how you learn the query syntax.
  return { data, url: url.replace(config.token, "<token>") };
};

export interface SearchArgs {
  filters: Record<string, string | undefined>;
  top: number;
  skip: number;
  sort?: string;
  dir?: string;
}

export const buildFilter = (filters: Record<string, string | undefined>): string => {
  const clauses: string[] = [];
  for (const [key, build] of Object.entries(FILTERS)) {
    const raw = filters[key];
    if (raw === undefined || raw === "") continue;
    const clause = build(raw);
    if (clause) clauses.push(clause);
  }
  // AND across different filters, matching how the listings route composes its
  // conditions — each additional control narrows the result set.
  return clauses.join(" and ");
};

export const searchProperties = async (args: SearchArgs) => {
  const filter = buildFilter(args.filters);
  const sort = SORT_FIELDS[args.sort ?? ""] ?? "ModificationTimestamp";
  const dir = args.dir?.toLowerCase() === "asc" ? "asc" : "desc";

  const { data, url } = await bridgeQuery("Property", {
    $select: SELECT_FIELDS.join(","),
    $filter: filter || undefined,
    $top: String(Math.min(args.top, MAX_TOP)),
    $skip: String(args.skip),
    $orderby: `${sort} ${dir}`,
    // Bridge only returns a total when asked, and the explorer needs it for
    // pagination. A live replication job would skip this — it's an extra count
    // over the filtered set on every page.
    $count: "true",
  });

  return {
    results: data.value.map(toMlsListing),
    total: data["@odata.count"] ?? data.value.length,
    query: { filter: filter || "(none)", orderby: `${sort} ${dir}`, url },
  };
};
