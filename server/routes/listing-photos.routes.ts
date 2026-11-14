import { randomUUID } from "node:crypto";
import path from "node:path";
import { Hono } from "hono";
import type { AuthEnv } from "../auth";
import { apiError, requireUuid } from "../http";
import {
  detectListingImage,
  MAX_LISTING_PHOTO_BYTES,
  MAX_LISTING_PHOTOS,
  readListingPhoto,
  readListingThumbnail,
  removeListingPhoto,
  writeListingPhoto,
} from "../listing-media";
import {
  Listing,
  ListingPhoto,
  type ListingPhotoInstance,
} from "../sequelize/models";

const app = new Hono<AuthEnv>();

const publicPhoto = (photo: ListingPhotoInstance) => ({
  id: photo.id,
  listingId: photo.listingId,
  originalName: photo.originalName,
  contentType: photo.contentType,
  sizeBytes: photo.sizeBytes,
  position: photo.position,
  createdAt: photo.createdAt,
});

const requireListing = async (listingId: string): Promise<void> => {
  if (!(await Listing.findByPk(listingId, { attributes: ["id"] }))) {
    throw apiError(404, "listing_not_found");
  }
};

app.get("/:listingId/photos", async (c) => {
  const listingId = requireUuid(c.req.param("listingId"));
  await requireListing(listingId);
  const photos = await ListingPhoto.findAll({
    where: { listingId },
    order: [
      ["position", "ASC"],
      ["createdAt", "ASC"],
    ],
  });
  return c.json({ photos: photos.map(publicPhoto) });
});

app.post("/:listingId/photos", async (c) => {
  const listingId = requireUuid(c.req.param("listingId"));
  await requireListing(listingId);

  if ((await ListingPhoto.count({ where: { listingId } })) >= MAX_LISTING_PHOTOS) {
    throw apiError(422, "photo_limit_reached");
  }

  const form = await c.req.raw.formData().catch(() => null);
  const entry = form?.get("photo");
  if (!(entry instanceof File)) throw apiError(422, "photo_required");
  if (entry.size === 0 || entry.size > MAX_LISTING_PHOTO_BYTES) {
    throw apiError(422, "invalid_photo_size");
  }

  const bytes = Buffer.from(await entry.arrayBuffer());
  const detected = detectListingImage(bytes);
  if (!detected) throw apiError(422, "unsupported_photo_type");

  const storageKey = `${randomUUID()}.${detected.extension}`;
  // Browsers normally send only a base name, but strip either path separator
  // before keeping it as display metadata in case a non-browser client does not.
  const baseName = path.basename(entry.name.replaceAll("\\", "/")).trim();
  const originalName = (baseName || `photo.${detected.extension}`).slice(0, 255);
  const position = await ListingPhoto.count({ where: { listingId } });

  await writeListingPhoto(listingId, storageKey, bytes).catch((error: unknown) => {
    console.error(`Could not store a photo for listing ${listingId}:`, error);
    throw apiError(503, "photo_storage_unavailable");
  });
  try {
    const photo = await ListingPhoto.create({
      listingId,
      storageKey,
      originalName,
      contentType: detected.contentType,
      sizeBytes: bytes.length,
      position,
    });
    return c.json({ photo: publicPhoto(photo) }, 201);
  } catch (error) {
    // Do not leave an unreferenced file if the metadata insert fails.
    await removeListingPhoto(listingId, storageKey).catch(() => undefined);
    throw error;
  }
});

// A soft-deleted property keeps its files for recovery, but they must no
// longer be reachable through an old content or thumbnail URL.
const findPhoto = async (listingId: string, photoId: string): Promise<ListingPhotoInstance> => {
  await requireListing(listingId);
  const photo = await ListingPhoto.findOne({ where: { id: photoId, listingId } });
  if (!photo) throw apiError(404, "listing_photo_not_found");
  return photo;
};

const imageResponse = (bytes: Buffer, contentType: string): Response =>
  new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.length),
      // A photo id's bytes can never change: there is no edit endpoint, and the
      // file is written once under a unique key (`wx`); its thumbnail is
      // derived from those same bytes. So the browser may keep either for a
      // year without revalidating. `private` keeps shared caches (Cloudflare)
      // from holding a photo that only a signed-in user may see.
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });

const originalResponse = async (photo: ListingPhotoInstance): Promise<Response> => {
  const bytes = await readListingPhoto(photo.listingId, photo.storageKey).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw apiError(404, "listing_photo_content_not_found");
      console.error(`Could not read listing photo ${photo.id}:`, error);
      throw apiError(503, "photo_storage_unavailable");
    }
  );
  return imageResponse(bytes, photo.contentType);
};

// Full size: the full-screen viewer only.
app.get("/:listingId/photos/:photoId/content", async (c) => {
  const photo = await findPhoto(
    requireUuid(c.req.param("listingId")),
    requireUuid(c.req.param("photoId"))
  );
  return originalResponse(photo);
});

// A small WebP for the property's photo grid (see listing-media.ts).
app.get("/:listingId/photos/:photoId/thumbnail", async (c) => {
  const photo = await findPhoto(
    requireUuid(c.req.param("listingId")),
    requireUuid(c.req.param("photoId"))
  );
  const thumbnail = await readListingThumbnail(photo.listingId, photo.storageKey).catch(
    (error: unknown) => {
      console.error(`Could not make a thumbnail for listing photo ${photo.id}:`, error);
      return null;
    }
  );
  // Every stored photo passed a magic-byte check, so a failure here is an
  // image the browser may still render (or a missing original, which the
  // fallback reports as a 404). A slow grid cell beats an empty one.
  return thumbnail ? imageResponse(thumbnail, "image/webp") : originalResponse(photo);
});

app.delete("/:listingId/photos/:photoId", async (c) => {
  const listingId = requireUuid(c.req.param("listingId"));
  const photoId = requireUuid(c.req.param("photoId"));
  await requireListing(listingId);
  const photo = await ListingPhoto.findOne({ where: { id: photoId, listingId } });
  if (!photo) throw apiError(404, "listing_photo_not_found");

  await photo.destroy();
  // The visible record is already gone. A filesystem failure should not turn
  // a successful delete into an unretryable 500; log the orphan for cleanup.
  await removeListingPhoto(listingId, photo.storageKey).catch((error: unknown) => {
    console.error(`Could not remove listing photo ${photo.id} from storage:`, error);
  });
  return c.body(null, 204);
});

export default app;
