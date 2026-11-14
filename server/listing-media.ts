import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const MAX_LISTING_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_LISTING_PHOTOS = 50;

export interface DetectedListingImage {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
}

// MIME types supplied by a browser or remote server are only hints. Check the
// bytes before storing a file so it can safely be served as an image later.
export const detectListingImage = (bytes: Buffer): DetectedListingImage | null => {
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

// The repository-local default makes development zero-config. Production
// mounts a named Docker volume at the same relative location, so rebuilding
// the API image does not remove uploaded originals.
const mediaRoot = (): string =>
  path.resolve(process.env.LISTING_MEDIA_DIR?.trim() || path.join(process.cwd(), "uploads"));

const listingDirectory = (listingId: string): string => path.join(mediaRoot(), listingId);

const storedPath = (listingId: string, storageKey: string): string =>
  path.join(listingDirectory(listingId), storageKey);

// --- Thumbnails --------------------------------------------------------------
// The property grid shows up to 50 photos in cells a few hundred pixels wide,
// and the originals are full-resolution MLS or phone images of up to 10 MB.
// Each grid cell gets a small WebP instead; the original is only sent for the
// full-screen viewer.
//
// A thumbnail is derived data, never a source of truth: no table records it,
// it lives in a `thumbs/` folder beside its original (so deleting a listing's
// folder takes its thumbnails too), and if one is missing it is rebuilt on the
// next request. That is also how photos stored before thumbnails existed get
// one, with no migration or backfill job.

// Grid cells are 4:3 and at most ~320 CSS px wide, so 640x480 covers a cell
// at 2x pixel density. `outside` keeps the aspect ratio and makes both sides
// at least that large, so the cell's `object-fit: cover` crop never upscales.
const THUMBNAIL_WIDTH = 640;
const THUMBNAIL_HEIGHT = 480;
// Visually indistinguishable from the original at cell size; typically 30-80
// KB against several MB.
const THUMBNAIL_QUALITY = 72;

// The files on disk are the cache. libvips' own in-memory operation cache
// would only hold decoded images the API won't ask for again, inside a
// container capped at 512 MB.
sharp.cache(false);

// Opening a never-viewed property asks for every thumbnail at once, and a
// large PNG decodes to ~100 MB before it is shrunk (JPEG can decode at reduced
// size; PNG cannot). Two at a time keeps that burst well under the API's
// memory limit while still keeping a multi-core host busy.
const MAX_CONCURRENT_THUMBNAILS = 2;
let runningThumbnails = 0;
const waitingThumbnails: Array<() => void> = [];

const acquireThumbnailSlot = (): Promise<void> => {
  if (runningThumbnails < MAX_CONCURRENT_THUMBNAILS) {
    runningThumbnails += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waitingThumbnails.push(resolve));
};

// Hand the slot straight to the next waiter rather than decrementing, so a
// request arriving in between can't take it and push the count past the cap.
const releaseThumbnailSlot = (): void => {
  const next = waitingThumbnails.shift();
  if (next) next();
  else runningThumbnails -= 1;
};

// One generation per file at a time. The upload path and a viewer's request
// can race for the same new photo, and two writers would do the work twice.
const pendingThumbnails = new Map<string, Promise<Buffer>>();

const thumbnailPath = (listingId: string, storageKey: string): string =>
  path.join(listingDirectory(listingId), "thumbs", `${storageKey}.webp`);

const generateThumbnail = async (listingId: string, storageKey: string): Promise<Buffer> => {
  const target = thumbnailPath(listingId, storageKey);
  await acquireThumbnailSlot();
  try {
    // From the path, not a Buffer, so libvips streams the file and can use
    // JPEG shrink-on-load instead of holding all of the original in memory.
    const bytes = await sharp(storedPath(listingId, storageKey))
      // The WebP is written without the original's metadata, so its EXIF
      // orientation has to be applied to the pixels or phone photos come out
      // sideways (the browser rotates the original by that same tag).
      .autoOrient()
      .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, { fit: "outside", withoutEnlargement: true })
      .webp({ quality: THUMBNAIL_QUALITY })
      .toBuffer();
    await mkdir(path.dirname(target), { recursive: true });
    // Write then rename: a rename is atomic, so a concurrent reader (or a
    // crash mid-write) can never leave a truncated file that is then served
    // as the thumbnail forever.
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, target);
    return bytes;
  } finally {
    releaseThumbnailSlot();
  }
};

const ensureThumbnail = (listingId: string, storageKey: string): Promise<Buffer> => {
  const key = thumbnailPath(listingId, storageKey);
  let job = pendingThumbnails.get(key);
  if (!job) {
    job = generateThumbnail(listingId, storageKey).finally(() => pendingThumbnails.delete(key));
    pendingThumbnails.set(key, job);
  }
  return job;
};

/**
 * The stored thumbnail, generated from the original first if it doesn't exist
 * yet. Rejects if the original can't be decoded; callers fall back to serving
 * the original, which a browser may still be able to show.
 */
export const readListingThumbnail = async (
  listingId: string,
  storageKey: string
): Promise<Buffer> => {
  try {
    return await readFile(thumbnailPath(listingId, storageKey));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return ensureThumbnail(listingId, storageKey);
};

export const writeListingPhoto = async (
  listingId: string,
  storageKey: string,
  bytes: Buffer
): Promise<void> => {
  await mkdir(listingDirectory(listingId), { recursive: true });
  // `wx` is a final guard against an astronomically unlikely UUID collision:
  // never overwrite an existing photo, even if a key is somehow repeated.
  await writeFile(storedPath(listingId, storageKey), bytes, { flag: "wx" });
  // Made now so the first person to open the property doesn't wait for it.
  // Every upload path (manual, Matrix import) comes through here, which is why
  // it's done in this function and not in each route. Best effort: the upload
  // itself has succeeded, and a missing thumbnail is rebuilt on first view.
  await ensureThumbnail(listingId, storageKey).catch((error: unknown) => {
    console.error(`Could not make a thumbnail for ${listingId}/${storageKey}:`, error);
  });
};

export const readListingPhoto = (listingId: string, storageKey: string): Promise<Buffer> =>
  readFile(storedPath(listingId, storageKey));

export const removeListingPhoto = async (
  listingId: string,
  storageKey: string
): Promise<void> => {
  // A missing file is already the desired result; surface other filesystem
  // failures so operators can see a permissions or disk problem.
  const ignoreMissing = (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  };
  // Let an in-flight generation finish first, or it would write its thumbnail
  // after the unlink below and leave an orphan beside a deleted photo.
  await pendingThumbnails.get(thumbnailPath(listingId, storageKey))?.catch(() => undefined);
  await unlink(storedPath(listingId, storageKey)).catch(ignoreMissing);
  await unlink(thumbnailPath(listingId, storageKey)).catch(ignoreMissing);
};

export const removeAllListingPhotos = (listingId: string): Promise<void> =>
  rm(listingDirectory(listingId), { recursive: true, force: true });
