import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { Op, type WhereOptions } from "sequelize";
import type { AuthEnv } from "../auth";
import { bigDistrictConfigured, lookupListing } from "../bigdistrict";
import {
  detectListingImage,
  MAX_LISTING_PHOTO_BYTES,
  MAX_LISTING_PHOTOS,
  removeAllListingPhotos,
  removeListingPhoto,
  writeListingPhoto,
} from "../listing-media";
import {
  fetchMatrixPhoto,
  parseMatrixSharedLink,
  readMatrixListing,
} from "../matrix";
import { Contact, Listing, ListingPhoto } from "../sequelize/models";
import {
  apiError,
  parsePage,
  pickFields,
  requireFields,
  requireNonEmpty,
  requireUuid,
} from "../http";

const app = new Hono<AuthEnv>();

const WRITABLE = [
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "postalCode",
  "mlsNumber",
  "status",
  "listingType",
  "listPriceCents",
  "bedrooms",
  "bathrooms",
  "livingAreaSqft",
  "lotAcres",
  "yearBuilt",
  "parcelNumber",
  "listedOn",
  "sellerContactId",
  "externalLinks",
  "notes",
] as const;

const REQUIRED_ON_CREATE = ["addressLine1", "city", "state", "postalCode"] as const;
const MAX_MATRIX_LINK_LENGTH = 2000;
const MATRIX_PHOTO_CONCURRENCY = 4;

const SORT_FIELDS: Record<string, string> = {
  createdAt: "createdAt",
  updatedAt: "updatedAt",
  listPriceCents: "listPriceCents",
  listedOn: "listedOn",
  status: "status",
};

interface ExternalLink {
  label: string;
  url: string;
}

// Links are rendered as anchors on the detail page, so accept web URLs only.
// The bounds also keep a single listing PATCH from becoming an unbounded JSON
// storage endpoint while still allowing more portals than an agent will use.
const normalizeExternalLinks = (value: unknown): ExternalLink[] => {
  if (!Array.isArray(value) || value.length > 20) {
    throw apiError(422, "invalid_external_links", {
      externalLinks: "must be an array of at most 20 links",
    });
  }

  return value.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw apiError(422, "invalid_external_links", {
        [`externalLinks.${index}`]: "must contain a label and URL",
      });
    }

    const source = item as Record<string, unknown>;
    const label = typeof source.label === "string" ? source.label.trim() : "";
    const url = typeof source.url === "string" ? source.url.trim() : "";
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw apiError(422, "invalid_external_links", {
        [`externalLinks.${index}.url`]: "must be a valid web URL",
      });
    }

    if (!label || label.length > 80 || url.length > 2000) {
      throw apiError(422, "invalid_external_links", {
        [`externalLinks.${index}`]: "label and URL are required and must fit",
      });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw apiError(422, "invalid_external_links", {
        [`externalLinks.${index}.url`]: "must use http or https",
      });
    }

    return { label, url };
  });
};

const normalizeListingValues = (
  values: Partial<Record<(typeof WRITABLE)[number], unknown>>
): void => {
  if (values.externalLinks !== undefined) {
    values.externalLinks = normalizeExternalLinks(values.externalLinks);
  }
};

const matrixLinkFromBody = (body: unknown): URL => {
  const value = (body as { url?: unknown } | null)?.url;
  if (typeof value !== "string" || !value.trim() || value.length > MAX_MATRIX_LINK_LENGTH) {
    throw apiError(422, "unsupported_matrix_link");
  }
  const link = parseMatrixSharedLink(value.trim());
  if (!link) throw apiError(422, "unsupported_matrix_link");
  return link;
};

// GET /api/listings/lookup — whether "Add with Zillow" is available, so the
// client can hide the button instead of offering one that can only fail.
app.get("/lookup", (c) => c.json({ available: bigDistrictConfigured() }));

// POST /api/listings/lookup  { url }
// Turns a Zillow link into a DRAFT listing — nothing is saved. The address is
// read from the link and matched to county records by BigDistrict; see
// server/bigdistrict.ts for why no listing site is ever contacted. The client
// opens the normal new-listing form on the result, and the listing is only
// created when the person reviews it and presses Create.
app.post("/lookup", async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  const url = (body as { url?: unknown } | null)?.url;
  // Bounded before it is forwarded anywhere: it is free text from a form.
  if (typeof url !== "string" || !url.trim() || url.length > 600) {
    throw apiError(422, "unsupported_listing_url");
  }
  return c.json({ lookup: await lookupListing(url.trim(), c.get("auth").user.id) });
});

// A public Matrix share contains the MLS's own listing data. It is fetched by
// the server (not the browser, where CORS blocks it) and returned only as a
// draft for review. Nothing is stored until the ordinary create form is saved.
app.post("/matrix/lookup", async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  const { lookup } = await readMatrixListing(matrixLinkFromBody(body));
  return c.json({ lookup });
});

// GET /api/listings?q=&status=&city=&minPrice=&maxPrice=&sort=&dir=&limit=&offset=
// Prices are cents on the wire, matching the column — the client formats.
app.get("/", async (c) => {
  const query = c.req.query();
  const { limit, offset } = parsePage(query);

  // Filters accumulate as a list and get AND-ed together at the end — see the
  // same pattern in contacts.routes.ts.
  const conditions: WhereOptions[] = [];
  if (query.status) conditions.push({ status: query.status });
  if (query.city) conditions.push({ city: { [Op.iLike]: query.city } });

  const min = parseInt(query.minPrice ?? "", 10);
  const max = parseInt(query.maxPrice ?? "", 10);
  if (Number.isFinite(min) || Number.isFinite(max)) {
    conditions.push({
      listPriceCents: {
        ...(Number.isFinite(min) ? { [Op.gte]: min } : {}),
        ...(Number.isFinite(max) ? { [Op.lte]: max } : {}),
      },
    });
  }

  if (query.q) {
    const term = `%${query.q}%`;
    conditions.push({
      [Op.or]: [
        { addressLine1: { [Op.iLike]: term } },
        { city: { [Op.iLike]: term } },
        { postalCode: { [Op.iLike]: term } },
        { mlsNumber: { [Op.iLike]: term } },
      ],
    });
  }

  const where: WhereOptions = conditions.length > 0 ? { [Op.and]: conditions } : {};

  const sort = SORT_FIELDS[query.sort ?? ""] ?? "createdAt";
  const dir = query.dir?.toLowerCase() === "asc" ? "ASC" : "DESC";

  const { rows, count } = await Listing.findAndCountAll({
    where,
    include: [{ model: Contact, as: "seller" }],
    order: [[sort, dir]],
    limit,
    offset,
    // findAndCountAll counts the joined rows without this, which inflates the
    // total once a listing has more than one associated row.
    distinct: true,
  });

  return c.json({ results: rows, total: count });
});

app.get("/:id", async (c) => {
  const id = requireUuid(c.req.param("id"));
  const listing = await Listing.findByPk(id, {
    include: [{ model: Contact, as: "seller" }],
  });
  if (!listing) throw apiError(404, "listing_not_found");
  return c.json({ listing });
});

app.post("/", async (c) => {
  const values = pickFields(await c.req.json(), WRITABLE);
  requireFields(values, REQUIRED_ON_CREATE);
  normalizeListingValues(values);
  const listing = await Listing.create(values as never);
  return c.json({ listing }, 201);
});

app.patch("/:id", async (c) => {
  const id = requireUuid(c.req.param("id"));
  const values = pickFields(await c.req.json(), WRITABLE);
  requireNonEmpty(values);
  normalizeListingValues(values);

  const listing = await Listing.findByPk(id);
  if (!listing) throw apiError(404, "listing_not_found");

  await listing.update(values as never);
  return c.json({ listing });
});

// Re-fetch the reviewed Matrix listing and copy its expiring media into this
// app's own photo store. Original names are deterministic, making a retry
// idempotent after a partial network failure.
app.post("/:id/matrix-photos", async (c) => {
  const id = requireUuid(c.req.param("id"));
  const listing = await Listing.findByPk(id);
  if (!listing) throw apiError(404, "listing_not_found");

  const body: unknown = await c.req.json().catch(() => null);
  const matrix = await readMatrixListing(matrixLinkFromBody(body));
  const matrixMls = matrix.lookup.draft.mlsNumber;
  if (listing.mlsNumber && matrixMls && listing.mlsNumber !== matrixMls) {
    throw apiError(422, "matrix_listing_mismatch");
  }

  const existing = await ListingPhoto.findAll({
    where: { listingId: id },
    attributes: ["originalName", "position"],
  });
  const existingNames = new Set(existing.map((photo) => photo.originalName));
  const safeMls = (matrixMls || "listing").replace(/[^a-z0-9_-]/gi, "-");
  const items = matrix.photoUrls.map((url, index) => ({
    url,
    index,
    stem: `matrix-${safeMls}-${index + 1}`,
  }));
  const alreadyPresent = items.filter((item) =>
    [...existingNames].some((name) => name.startsWith(`${item.stem}.`))
  ).length;
  const pending = items.filter(
    (item) => ![...existingNames].some((name) => name.startsWith(`${item.stem}.`))
  );
  const capacity = Math.max(0, MAX_LISTING_PHOTOS - existing.length);
  const selected = pending.slice(0, capacity);
  const omitted = pending.length - selected.length;
  const nextPosition =
    existing.reduce((highest, photo) => Math.max(highest, photo.position), -1) + 1;
  let cursor = 0;
  let imported = 0;
  let failed = 0;

  const worker = async () => {
    while (cursor < selected.length) {
      const selectionIndex = cursor;
      cursor += 1;
      const item = selected[selectionIndex]!;
      let storageKey: string | null = null;
      try {
        const bytes = await fetchMatrixPhoto(item.url, MAX_LISTING_PHOTO_BYTES);
        const detected = bytes ? detectListingImage(bytes) : null;
        if (!bytes || !detected) {
          failed += 1;
          continue;
        }

        storageKey = `${randomUUID()}.${detected.extension}`;
        await writeListingPhoto(id, storageKey, bytes);
        await ListingPhoto.create({
          listingId: id,
          storageKey,
          originalName: `${item.stem}.${detected.extension}`,
          contentType: detected.contentType,
          sizeBytes: bytes.length,
          position: nextPosition + selectionIndex,
        });
        imported += 1;
      } catch (error) {
        failed += 1;
        if (storageKey) await removeListingPhoto(id, storageKey).catch(() => undefined);
        console.error(`Could not import Matrix photo ${item.index + 1} for ${id}:`, error);
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(MATRIX_PHOTO_CONCURRENCY, selected.length) },
      () => worker()
    )
  );

  return c.json({ imported, alreadyPresent, failed, omitted });
});

app.delete("/:id", async (c) => {
  const id = requireUuid(c.req.param("id"));
  const deleted = await Listing.destroy({ where: { id } });
  if (deleted === 0) throw apiError(404, "listing_not_found");
  // The FK cascade removes metadata; the media directory is outside Postgres
  // and must be removed separately after the listing itself is gone.
  await removeAllListingPhotos(id).catch((error: unknown) => {
    console.error(`Could not remove media for deleted listing ${id}:`, error);
  });
  return c.body(null, 204);
});

export default app;
