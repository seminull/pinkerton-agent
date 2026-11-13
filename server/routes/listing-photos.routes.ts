import { randomUUID } from "node:crypto";
import path from "node:path";
import { Hono } from "hono";
import type { AuthEnv } from "../auth";
import { apiError, requireUuid } from "../http";
import {
  readListingPhoto,
  removeListingPhoto,
  writeListingPhoto,
} from "../listing-media";
import {
  Listing,
  ListingPhoto,
  type ListingPhotoInstance,
} from "../sequelize/models";

const app = new Hono<AuthEnv>();

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_PHOTOS_PER_LISTING = 50;

interface DetectedImage {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
}

// Browser MIME types are hints supplied by the client. Check the actual magic
// bytes before storing a file so an executable renamed to .jpg cannot be served
// back as trusted image content.
const detectImage = (bytes: Buffer): DetectedImage | null => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { contentType: "image/png", extension: "png" };
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { contentType: "image/webp", extension: "webp" };
  }
  return null;
};

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

  if ((await ListingPhoto.count({ where: { listingId } })) >= MAX_PHOTOS_PER_LISTING) {
    throw apiError(422, "photo_limit_reached");
  }

  const form = await c.req.raw.formData().catch(() => null);
  const entry = form?.get("photo");
  if (!(entry instanceof File)) throw apiError(422, "photo_required");
  if (entry.size === 0 || entry.size > MAX_PHOTO_BYTES) {
    throw apiError(422, "invalid_photo_size");
  }

  const bytes = Buffer.from(await entry.arrayBuffer());
  const detected = detectImage(bytes);
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

app.get("/:listingId/photos/:photoId/content", async (c) => {
  const listingId = requireUuid(c.req.param("listingId"));
  const photoId = requireUuid(c.req.param("photoId"));
  const photo = await ListingPhoto.findOne({ where: { id: photoId, listingId } });
  if (!photo) throw apiError(404, "listing_photo_not_found");

  const bytes = await readListingPhoto(listingId, photo.storageKey).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw apiError(404, "listing_photo_content_not_found");
      console.error(`Could not read listing photo ${photo.id}:`, error);
      throw apiError(503, "photo_storage_unavailable");
    }
  );
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": photo.contentType,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=86400",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

app.delete("/:listingId/photos/:photoId", async (c) => {
  const listingId = requireUuid(c.req.param("listingId"));
  const photoId = requireUuid(c.req.param("photoId"));
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
