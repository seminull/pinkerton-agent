import { apiError } from "./http";
import type { ListingLookup, ListingStatus } from "./types";

// Turning a Matrix shared link from "Add with URL" into a draft listing.
//
// Matrix is the MLS's own application. An agent with NTREIS access can share a
// listing from it, which produces a public page — no login — meant to be sent
// to a client. This module reads that page: the one the agent chose to share,
// fetched once, when they paste its link. That is the whole of it. There is no
// crawling, no search, no MLS credential held here, and nothing is refreshed in
// the background; a listing imported this way is a copy as of the moment of
// import and is edited by hand afterwards like any other.
//
// This is the opposite trade to server/bigdistrict.ts, which never contacts the
// listing site and so can only know what the county knows. A shared link is the
// agent's own MLS data, so here the price, status, MLS number, description, and
// photos all come through.
//
// The page is server-rendered HTML with no API behind it, so it is read with
// patterns rather than a parser (no HTML dependency for one page shape). Every
// pattern is allowed to miss: a field Matrix renames or drops comes back blank
// in the form for the person to fill, and only a page with no listing on it at
// all is an error.

// Shared links live on a per-MLS subdomain of this one host (NTREIS is
// ntrdd.mlsmatrix.com). This is an allowlist because the server fetches
// whatever passes it: anything looser would let a signed-in user point the API
// at an arbitrary URL, including ones only reachable from inside the server.
const MATRIX_HOST_SUFFIX = ".mlsmatrix.com";
const SHARED_PATH = /^\/matrix\/shared\/[^/]+/i;
const MEDIA_PATH = /^\/mediaserver\/getmedia\.ashx$/i;

// A person is watching a spinner for the page; photos are fetched many at a
// time after the listing exists, so each gets a little longer.
const PAGE_TIMEOUT_MS = 10_000;
const PHOTO_TIMEOUT_MS = 15_000;
// A real page is ~100 KB. The cap only exists so a wrong or hostile response
// can't be read into memory without limit.
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 3;

/** The link as a URL if it is a Matrix shared link, otherwise null. */
export const parseMatrixSharedLink = (raw: string): URL | null => {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!url.hostname.toLowerCase().endsWith(MATRIX_HOST_SUFFIX)) return null;
  if (!SHARED_PATH.test(url.pathname)) return null;
  return url;
};

const isMatrixHost = (url: URL): boolean =>
  url.protocol === "https:" && url.hostname.toLowerCase().endsWith(MATRIX_HOST_SUFFIX);

// Redirects are followed by hand so each hop is checked against the allowlist.
// fetch's own "follow" would happily leave the host the first check approved.
const fetchWithinMatrix = async (start: URL, timeoutMs: number): Promise<Response> => {
  if (!isMatrixHost(start)) throw new Error(`refused non-Matrix host ${start.hostname}`);
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    const next = new URL(location, url);
    if (!isMatrixHost(next)) throw new Error(`redirected off Matrix to ${next.hostname}`);
    url = next;
  }
  throw new Error("too many redirects");
};

const readBounded = async (response: Response, maxBytes: number): Promise<Buffer> => {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`response is larger than ${maxBytes} bytes`);
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`response is larger than ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
};

// --- Reading the page --------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const decodeEntities = (value: string): string =>
  value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (!code.startsWith("#")) return ENTITIES[code.toLowerCase()] ?? whole;
    const point =
      code[1]?.toLowerCase() === "x"
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
    // An out-of-range reference would make fromCodePoint throw; leave it as
    // written rather than fail the whole import over one character.
    return Number.isInteger(point) && point > 0 && point <= 0x10ffff
      ? String.fromCodePoint(point)
      : whole;
  });

/** Markup to the text a person would read: tags out, entities decoded, tidy. */
const toText = (markup: string): string =>
  decodeEntities(markup.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

const first = (html: string, pattern: RegExp): string => {
  const match = pattern.exec(html);
  return match?.[1] ? toText(match[1]) : "";
};

// Every "Label  Value" row on the page, keyed by label. Matrix draws these two
// ways — side by side in the summary, in a two-column table below — but both
// are a `d-textStrong` label followed by a `d-text` value. The first occurrence
// of a label wins: the summary repeats some rows from the table, and where the
// two differ the summary is the plain value ("3,756" against "3,756 / Public
// Records").
const readFields = (html: string): Map<string, string> => {
  const fields = new Map<string, string>();
  const row =
    /<span class="d-textStrong[^"]*">([\s\S]*?)<\/span>(?:\s*<\/div>\s*<div[^>]*>)?\s*<span class="d-text(?!Strong)[^"]*">([\s\S]*?)<\/span>/gi;
  for (const match of html.matchAll(row)) {
    const label = match[1] ? toText(match[1]) : "";
    const value = match[2] ? toText(match[2]) : "";
    if (label && value && !fields.has(label)) fields.set(label, value);
  }
  return fields;
};

/** The leading number of "3,756 / Public Records", "$363 / Annually", "2014 / ". */
const leadingNumber = (value: string | undefined): number | null => {
  const match = /-?\d[\d,]*(?:\.\d+)?/.exec(value ?? "");
  if (!match) return null;
  const number = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
};

const positive = (value: string | undefined): number | null => {
  const number = leadingNumber(value);
  return number !== null && number > 0 ? number : null;
};

// Matrix's status wording, onto this app's seven. Matched by what the status
// means for the agent rather than letter for letter: NTREIS's "Active Option
// Contract", "Active Contingent" and "Active KO" all mean an offer has been
// accepted, which here is `pending`. Order matters — those must be tested
// before plain "active". An unrecognised status becomes null and the form
// falls back to Draft, which is visibly unfinished rather than quietly wrong.
type MatrixDraftStatus = Exclude<ListingStatus, "draft">;

const STATUS_RULES: [RegExp, MatrixDraftStatus][] = [
  [/coming soon/i, "coming_soon"],
  [/option|contingent|kick ?out|\bko\b|pending/i, "pending"],
  [/^active/i, "active"],
  [/sold|closed|leased/i, "sold"],
  [/cancel|withdrawn|hold|off market/i, "withdrawn"],
  [/expired/i, "expired"],
];

const mapStatus = (text: string): MatrixDraftStatus | null =>
  STATUS_RULES.find(([pattern]) => pattern.test(text))?.[1] ?? null;

// The page spells the state out. NTREIS is North Texas, so in practice this is
// always Texas; a two-letter code is passed through, and anything else is left
// blank for the person rather than guessed.
const stateCode = (name: string): string => {
  const trimmed = name.trim();
  if (/^texas$/i.test(trimmed)) return "TX";
  return /^[a-z]{2}$/i.test(trimmed) ? trimmed.toUpperCase() : "";
};

// The facts worth carrying over that have no column of their own. They go in
// the notes — under the description, labelled — rather than being dropped:
// they are what an agent looks a lease or a neighbourhood up for, and notes
// are already visible and editable. In page order; absent rows are skipped.
const NOTE_FIELDS: [label: string, heading: string][] = [
  ["Property Sub Type", "Type"],
  ["Subdivision Name", "Subdivision"],
  ["County", "County"],
  ["Stories Total", "Stories"],
  ["Garage Spaces", "Garage spaces"],
  ["HOA Type", "HOA"],
  ["HOA", "HOA dues"],
  ["School District", "School district"],
  ["Elementary School Name", "Elementary"],
  ["Middle School Name", "Middle school"],
  ["High School Name", "High school"],
  ["Available Date", "Available"],
  ["Deposit Amount", "Deposit"],
  ["Application Fee Amount", "Application fee"],
  ["Deposit Pet", "Pet deposit"],
  ["Monthly Pet Fee", "Monthly pet fee"],
  ["Furnished YN", "Furnished"],
  ["Tenant Pays", "Tenant pays"],
  ["Monies Required", "Due at signing"],
  ["List Office Name", "List office"],
  ["List Agent Full Name", "List agent"],
];

const buildNotes = (
  description: string,
  fields: Map<string, string>,
  mlsNumber: string
): string => {
  const lines = NOTE_FIELDS.flatMap(([label, heading]) => {
    const value = fields.get(label);
    return value ? [`${heading}: ${value}`] : [];
  });
  if (lines.length === 0) return description;
  // Dated, because this is a copy: the MLS record moves on and these lines
  // don't, and the date is what tells a later reader how stale they may be.
  const today = new Date().toISOString().slice(0, 10);
  const heading = `From NTREIS${mlsNumber ? ` (MLS# ${mlsNumber})` : ""}, as of ${today}:`;
  return [description, [heading, ...lines].join("\n")].filter(Boolean).join("\n\n");
};

// The photo viewer is started with one object literal mapping "<n>_<size>" to
// an image address, for every photo at three sizes (1 thumbnail, 3 medium,
// 5 large). The largest available of each photo is taken, in the viewer's own
// order. The page carries the map twice (desktop and mobile viewers), which is
// why photos are keyed by number instead of collected as they are found.
//
// Each address carries its own access token and is only as long-lived as the
// shared link, so photos are copied into this app's storage at import — a
// stored address would stop working when the link expires.
const readPhotoUrls = (html: string, origin: string): string[] => {
  const best = new Map<number, { size: number; url: string }>();
  for (const match of html.matchAll(/'(\d+)_(\d+)'\s*:\s*'(https:\/\/[^']+)'/g)) {
    const numberText = match[1];
    const sizeText = match[2];
    const address = match[3];
    if (!numberText || !sizeText || !address) continue;
    const number = Number(numberText);
    const size = Number(sizeText);
    let url: URL;
    try {
      url = new URL(decodeEntities(address));
    } catch {
      continue;
    }
    // Same host as the page it came from, and only the media endpoint: these
    // addresses come out of fetched HTML and are about to be fetched in turn.
    if (url.origin !== origin || !MEDIA_PATH.test(url.pathname)) continue;
    const current = best.get(number);
    if (!current || size > current.size) best.set(number, { size, url: url.toString() });
  }
  return [...best.entries()].sort(([a], [b]) => a - b).map(([, photo]) => photo.url);
};

interface MatrixListing {
  lookup: ListingLookup;
  /** Full-size photo addresses, in listing order. Short-lived; never stored. */
  photoUrls: string[];
}

/**
 * Fetch a Matrix shared link and read the listing on it. Throws an apiError
 * for every failure a person can act on. `link` must already have passed
 * parseMatrixSharedLink.
 */
export const readMatrixListing = async (link: URL): Promise<MatrixListing> => {
  let html: string;
  try {
    const response = await fetchWithinMatrix(link, PAGE_TIMEOUT_MS);
    if (!response.ok) throw new Error(`answered ${response.status}`);
    html = new TextDecoder().decode(await readBounded(response, MAX_PAGE_BYTES));
  } catch (err) {
    console.error("Matrix shared link: request failed:", err);
    throw apiError(502, "matrix_link_unavailable");
  }

  const fields = readFields(html);

  // The header: street on one line, "City, State ZIP" on the next.
  const header =
    /d-mega[^"]*"[^>]*>\s*<span class="formula J_formula">([\s\S]*?)<\/span>[\s\S]*?<span class="formula J_formula">([\s\S]*?)<\/span>/i.exec(
      html
    );
  const street = header?.[1] ? toText(header[1]) : "";
  const locality = /^(.*?),\s*([A-Za-z .]+?)\s+(\d{5}(?:-\d{4})?)$/.exec(
    header?.[2] ? toText(header[2]) : ""
  );

  const mlsNumber =
    first(html, /MLS#:\s*<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i) ||
    first(html, /property="og:description"[^>]*content="MLS# (\d+)/i);

  // No address and no MLS number means there is no listing on this page. A
  // shared link that has expired or been withdrawn still answers 200, so this —
  // not the HTTP status — is how that case is recognised.
  if (!street && !mlsNumber) throw apiError(422, "matrix_link_unreadable");

  const price = positive(first(html, /<span class="d-text d-fontSize--largest[^"]*">([\s\S]*?)<\/span>/i));
  const bathsFull = leadingNumber(fields.get("Bath Full")) ?? 0;
  const bathsHalf = leadingNumber(fields.get("Baths Half")) ?? 0;
  const bathrooms = bathsFull + bathsHalf * 0.5;
  const bedrooms = positive(fields.get("Beds Total"));
  const sqft = positive(fields.get("SqFt"));
  const description = first(html, /<span class="d-textSoft d-fontSize--small[^"]*">([\s\S]*?)<\/span>/i);
  const photoUrls = readPhotoUrls(html, link.origin);

  return {
    photoUrls,
    lookup: {
      source: "matrix",
      // The page is the listing itself, not a match against something else, so
      // there is no "approximate" here.
      status: "matched",
      quality: "exact",
      draft: {
        addressLine1: street,
        city: locality?.[1]?.trim() ?? "",
        state: locality?.[2] ? stateCode(locality[2]) : "",
        postalCode: locality?.[3] ?? "",
        bedrooms: bedrooms === null ? null : Math.round(bedrooms),
        bathrooms: bathrooms > 0 ? bathrooms : null,
        livingAreaSqft: sqft === null ? null : Math.round(sqft),
        lotAcres: positive(fields.get("Acres")) ?? positive(fields.get("Lot Size Area")),
        yearBuilt: positive(fields.get("Year Built")),
        notes: buildNotes(description, fields, mlsNumber),
        mlsNumber: mlsNumber || null,
        status: mapStatus(first(html, /<span class=['"]Status_[^'"]*['"]>([\s\S]*?)<\/span>/i)),
        // "Residential Lease" and "Commercial Lease" are leases; everything
        // else Matrix lists is for sale.
        listingType: /lease/i.test(fields.get("Property Type") ?? "") ? "lease" : "sale",
        // Dollars on the page, cents everywhere in this app.
        listPriceCents: price === null ? null : Math.round(price * 100),
        parcelNumber: fields.get("Parcel Number") ?? null,
      },
      county: fields.get("County") ?? null,
      bigDistrictUrl: null,
      zillowUrl: null,
      // Origin and path only, like the Zillow path: the query string of a
      // share link is tracking, not address.
      sourceUrl: `${link.origin}${link.pathname}`,
      candidates: 1,
      photoCount: photoUrls.length,
    },
  };
};

/**
 * Download one photo found by readMatrixListing. Returns null instead of
 * throwing: one photo failing must not cost the listing the other thirty-six.
 */
export const fetchMatrixPhoto = async (address: string, maxBytes: number): Promise<Buffer | null> => {
  try {
    const response = await fetchWithinMatrix(new URL(address), PHOTO_TIMEOUT_MS);
    if (!response.ok) return null;
    const bytes = await readBounded(response, maxBytes);
    return bytes.length > 0 && bytes.length <= maxBytes ? bytes : null;
  } catch (err) {
    console.error("Matrix photo: request failed:", err);
    return null;
  }
};
