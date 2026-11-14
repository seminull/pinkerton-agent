import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { Op, type WhereOptions } from "sequelize";
import type { AuthEnv } from "../auth";
import {
  bigDistrictConfigured,
  isBigDistrictUrl,
  isZillowUrl,
  lookupListing,
  resolvePropertyLinks,
} from "../bigdistrict";
import {
  detectListingImage,
  MAX_LISTING_PHOTO_BYTES,
  MAX_LISTING_PHOTOS,
  removeListingPhoto,
  writeListingPhoto,
} from "../listing-media";
import {
  fetchMatrixPhoto,
  parseMatrixSharedLink,
  readMatrixListing,
} from "../matrix";
import { Contact, Listing, ListingPhoto } from "../sequelize/models";
import type { ListingInstance } from "../sequelize/models";
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
const ADDRESS_FIELDS = ["addressLine1", "addressLine2", "city", "state", "postalCode"] as const;
const MAX_MATRIX_LINK_LENGTH = 2000;
const MATRIX_PHOTO_CONCURRENCY = 4;
const BIGDISTRICT_LINK_LABEL = "BigDistrict";
const ZILLOW_LINK_LABEL = "Zillow";

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

const canonicalizePropertyLinks = (links: ExternalLink[]): ExternalLink[] => {
  let keptBigDistrict = false;
  let keptZillow = false;
  return links.flatMap((link) => {
    if (isBigDistrictUrl(link.url)) {
      if (keptBigDistrict) return [];
      keptBigDistrict = true;
      return [{ label: BIGDISTRICT_LINK_LABEL, url: link.url }];
    }
    if (isZillowUrl(link.url)) {
      if (keptZillow) return [];
      keptZillow = true;
      return [{ label: ZILLOW_LINK_LABEL, url: link.url }];
    }
    return [link];
  });
};

// Existing rows are filled on detail reads, while creates and edits call the
// same helper immediately. Re-fetching before the write avoids adding a second
// link when two requests open the same legacy property at once.
const ensurePropertyLinks = async (
  listing: ListingInstance,
  requestedBy: string
): Promise<void> => {
  const currentLinks = canonicalizePropertyLinks(listing.externalLinks);
  const hasBigDistrict = currentLinks.some((link) => isBigDistrictUrl(link.url));
  const hasZillow = currentLinks.some((link) => isZillowUrl(link.url));
  if (hasBigDistrict && hasZillow) {
    if (JSON.stringify(currentLinks) !== JSON.stringify(listing.externalLinks)) {
      await listing.update({ externalLinks: currentLinks });
    }
    return;
  }

  const resolved = await resolvePropertyLinks(
    {
      addressLine1: listing.addressLine1,
      addressLine2: listing.addressLine2,
      city: listing.city,
      state: listing.state,
      postalCode: listing.postalCode,
    },
    requestedBy
  );
  const fresh = await Listing.findByPk(listing.id);
  if (!fresh) return;

  const freshLinks = canonicalizePropertyLinks(fresh.externalLinks);
  const nextLinks = [...freshLinks];
  if (!freshLinks.some((link) => isBigDistrictUrl(link.url))) {
    nextLinks.push({ label: BIGDISTRICT_LINK_LABEL, url: resolved.bigDistrictUrl });
  }
  if (!freshLinks.some((link) => isZillowUrl(link.url))) {
    nextLinks.push({ label: ZILLOW_LINK_LABEL, url: resolved.zillowUrl });
  }
  if (JSON.stringify(nextLinks) !== JSON.stringify(fresh.externalLinks)) {
    await fresh.update({ externalLinks: nextLinks });
  }
};

const findListingWithSeller = (id: string) =>
  Listing.findByPk(id, { include: [{ model: Contact, as: "seller" }] });

const matrixLinkFromBody = (body: unknown): URL => {
  const value = (body as { url?: unknown } | null)?.url;
  if (typeof value !== "string" || !value.trim() || value.length > MAX_MATRIX_LINK_LENGTH) {
    throw apiError(422, "unsupported_matrix_link");
  }
  const link = parseMatrixSharedLink(value.trim());
  if (!link) throw apiError(422, "unsupported_matrix_link");
  return link;
};

const listingUrlFromBody = (body: unknown): string => {
  const value = (body as { url?: unknown } | null)?.url;
  if (typeof value !== "string" || !value.trim() || value.length > MAX_MATRIX_LINK_LENGTH) {
    throw apiError(422, "unsupported_listing_url");
  }
  return value.trim();
};

const readMatrixLookup = async (link: URL) => {
  const { lookup } = await readMatrixListing(link);
  const draft = lookup.draft;
  const byMls = draft.mlsNumber
    ? await Listing.findOne({
        where: { mlsNumber: draft.mlsNumber },
        include: [{ model: Contact, as: "seller" }],
        order: [["updatedAt", "DESC"]],
      })
    : null;
  const postalPrefix = draft.postalCode.slice(0, 5);
  const byAddress =
    !byMls && draft.addressLine1 && draft.city && draft.state && postalPrefix
      ? await Listing.findOne({
          where: {
            addressLine1: { [Op.iLike]: draft.addressLine1.trim() },
            city: { [Op.iLike]: draft.city.trim() },
            state: { [Op.iLike]: draft.state.trim() },
            postalCode: { [Op.like]: `${postalPrefix}%` },
          },
          include: [{ model: Contact, as: "seller" }],
          order: [["updatedAt", "DESC"]],
        })
      : null;
  const existingListing = byMls ?? byAddress;
  const existingPhotoCount = existingListing
    ? await ListingPhoto.count({ where: { listingId: existingListing.id } })
    : 0;
  return {
    lookup,
    existingListing,
    existingPhotoCount,
    matchReason: byMls ? ("mls" as const) : byAddress ? ("address" as const) : null,
  };
};

// GET /api/listings/lookup — whether URL sources that need configuration are
// available. Matrix shared links work without a key.
app.get("/lookup", (c) => c.json({ available: bigDistrictConfigured() }));

// POST /api/listings/lookup  { url }
// Selects the parser from the URL. Matrix shares are read directly; Zillow
// links are matched to county records through BigDistrict. Both return the same
// draft envelope, and nothing is stored until the review form is saved.
app.post("/lookup", async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  const url = listingUrlFromBody(body);
  const matrixLink = parseMatrixSharedLink(url);
  if (matrixLink) return c.json(await readMatrixLookup(matrixLink));

  // Only Zillow is sent to BigDistrict. Source selection belongs here rather
  // than in the browser, and an unrelated URL is never forwarded to a service.
  if (!isZillowUrl(url) || url.length > 600) {
    throw apiError(422, "unsupported_listing_url");
  }
  return c.json({
    lookup: await lookupListing(url, c.get("auth").user.id),
    existingListing: null,
    existingPhotoCount: 0,
    matchReason: null,
  });
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
  const listing = await findListingWithSeller(id);
  if (!listing) throw apiError(404, "listing_not_found");
  await ensurePropertyLinks(listing, c.get("auth").user.id);
  return c.json({ listing: await findListingWithSeller(id) });
});

app.post("/", async (c) => {
  const values = pickFields(await c.req.json(), WRITABLE);
  requireFields(values, REQUIRED_ON_CREATE);
  normalizeListingValues(values);
  const listing = await Listing.create(values as never);
  await ensurePropertyLinks(listing, c.get("auth").user.id);
  return c.json({ listing: await findListingWithSeller(listing.id) }, 201);
});

app.patch("/:id", async (c) => {
  const id = requireUuid(c.req.param("id"));
  const values = pickFields(await c.req.json(), WRITABLE);
  requireNonEmpty(values);
  normalizeListingValues(values);

  const listing = await Listing.findByPk(id);
  if (!listing) throw apiError(404, "listing_not_found");

  const addressChanged = ADDRESS_FIELDS.some(
    (field) => values[field] !== undefined && values[field] !== listing[field]
  );
  if (addressChanged) {
    const links = (values.externalLinks ?? listing.externalLinks) as ExternalLink[];
    // The old parcel/search link describes the old address. Remove it before
    // the update so ensurePropertyLinks resolves the new property.
    values.externalLinks = links.filter(
      (link) => !isBigDistrictUrl(link.url) && !isZillowUrl(link.url)
    );
  }

  await listing.update(values as never);
  await ensurePropertyLinks(listing, c.get("auth").user.id);
  return c.json({ listing: await findListingWithSeller(id) });
});

// Re-fetch the reviewed Matrix listing and copy its expiring media into this
// app's own photo store. Original names are deterministic, making a retry
// idempotent after a partial network failure.
app.post("/:id/matrix-photos", async (c) => {
  const id = requireUuid(c.req.param("id"));
  const listing = await Listing.findByPk(id);
  if (!listing) throw apiError(404, "listing_not_found");

  const body: unknown = await c.req.json().catch(() => null);
  const replace = (body as { replace?: unknown } | null)?.replace === true;
  const matrix = await readMatrixListing(matrixLinkFromBody(body));
  const matrixMls = matrix.lookup.draft.mlsNumber;
  const matrixDraft = matrix.lookup.draft;
  const sameAddress =
    listing.addressLine1.trim().toLowerCase() ===
      matrixDraft.addressLine1.trim().toLowerCase() &&
    listing.city.trim().toLowerCase() === matrixDraft.city.trim().toLowerCase() &&
    listing.state.trim().toLowerCase() === matrixDraft.state.trim().toLowerCase() &&
    listing.postalCode.slice(0, 5) === matrixDraft.postalCode.slice(0, 5);
  // Partial replacement may intentionally retain the current MLS number while
  // selecting Matrix photos. Permit that only for the same exact property.
  if (
    listing.mlsNumber &&
    matrixMls &&
    listing.mlsNumber !== matrixMls &&
    !(replace && sameAddress)
  ) {
    throw apiError(422, "matrix_listing_mismatch");
  }

  const existing = await ListingPhoto.findAll({
    where: { listingId: id },
    attributes: ["id", "storageKey", "originalName", "position"],
  });
  const existingNames = new Set(existing.map((photo) => photo.originalName));
  const safeMls = (matrixMls || "listing").replace(/[^a-z0-9_-]/gi, "-");
  const items = matrix.photoUrls.map((url, index) => ({
    url,
    index,
    stem: `matrix-${safeMls}-${index + 1}`,
  }));
  const alreadyPresent = replace
    ? 0
    : items.filter((item) =>
        [...existingNames].some((name) => name.startsWith(`${item.stem}.`))
      ).length;
  const pending = replace
    ? items
    : items.filter(
        (item) => ![...existingNames].some((name) => name.startsWith(`${item.stem}.`))
      );
  // Replacement photos may temporarily coexist with the old set. They are
  // committed only after every new image is safely stored, so a network
  // failure never destroys the user's current gallery.
  const capacity = replace
    ? MAX_LISTING_PHOTOS
    : Math.max(0, MAX_LISTING_PHOTOS - existing.length);
  const selected = pending.slice(0, capacity);
  const omitted = pending.length - selected.length;
  const nextPosition =
    existing.reduce((highest, photo) => Math.max(highest, photo.position), -1) + 1;
  let cursor = 0;
  let imported = 0;
  let failed = 0;
  const createdPhotos: Array<{ id: string; storageKey: string }> = [];

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
        const photo = await ListingPhoto.create({
          listingId: id,
          storageKey,
          originalName: `${item.stem}.${detected.extension}`,
          contentType: detected.contentType,
          sizeBytes: bytes.length,
          position: replace ? selectionIndex : nextPosition + selectionIndex,
        });
        createdPhotos.push({ id: photo.id, storageKey });
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

  let replaced = false;
  if (replace && failed === 0 && omitted === 0) {
    await ListingPhoto.destroy({ where: { id: existing.map((photo) => photo.id) } });
    await Promise.all(
      existing.map(async (photo) => {
        await removeListingPhoto(id, photo.storageKey).catch((error: unknown) => {
          console.error(`Could not remove replaced photo ${photo.id} for ${id}:`, error);
        });
      })
    );
    replaced = true;
  } else if (replace) {
    // New set was incomplete. Roll it back and leave the old gallery intact.
    await ListingPhoto.destroy({ where: { id: createdPhotos.map((photo) => photo.id) } });
    await Promise.all(
      createdPhotos.map((photo) =>
        removeListingPhoto(id, photo.storageKey).catch(() => undefined)
      )
    );
    imported = 0;
  }

  return c.json({ imported, alreadyPresent, failed, omitted, replaced });
});

app.delete("/:id", async (c) => {
  const id = requireUuid(c.req.param("id"));
  const listing = await Listing.findByPk(id);
  if (!listing) throw apiError(404, "listing_not_found");
  // Listing is paranoid: this records deletedAt and deliberately preserves
  // activities, photo metadata, and stored files for a future restore action.
  await listing.destroy();
  return c.body(null, 204);
});

export default app;
