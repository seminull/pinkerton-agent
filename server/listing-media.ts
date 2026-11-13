import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

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

export const writeListingPhoto = async (
  listingId: string,
  storageKey: string,
  bytes: Buffer
): Promise<void> => {
  await mkdir(listingDirectory(listingId), { recursive: true });
  // `wx` is a final guard against an astronomically unlikely UUID collision:
  // never overwrite an existing photo, even if a key is somehow repeated.
  await writeFile(storedPath(listingId, storageKey), bytes, { flag: "wx" });
};

export const readListingPhoto = (listingId: string, storageKey: string): Promise<Buffer> =>
  readFile(storedPath(listingId, storageKey));

export const removeListingPhoto = async (
  listingId: string,
  storageKey: string
): Promise<void> => {
  await unlink(storedPath(listingId, storageKey)).catch((error: NodeJS.ErrnoException) => {
    // A missing file is already the desired result; surface other filesystem
    // failures so operators can see a permissions or disk problem.
    if (error.code !== "ENOENT") throw error;
  });
};

export const removeAllListingPhotos = (listingId: string): Promise<void> =>
  rm(listingDirectory(listingId), { recursive: true, force: true });
