import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

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
