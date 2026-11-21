// Where uploaded files live: vehicle images now, monthly reports later. Callers only see this interface, so switching
// between a local folder (development) and an S3-compatible bucket (Cloudflare R2, everywhere else) is a matter of
// STORAGE_DRIVER and its keys.
export interface StoredFile {
  body: Uint8Array;
  contentType: string;
}

export interface Storage {
  // The bucket new files go to, recorded next to each key (e.g. VehicleImage.bucket).
  readonly bucket: string;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  // Null when there's no such file.
  get(key: string): Promise<StoredFile | null>;
  // Deleting a file that isn't there is not an error.
  delete(key: string): Promise<void>;
  // A link that reads the file until it expires. The bucket itself is private.
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

// How long a signed link lasts unless told otherwise: long enough to load a page and look at it, short enough that a
// copied link soon stops working.
export const SIGNED_URL_LIFETIME = 15 * 60;

// Keys are made by the app (e.g. vehicles/<id>/<uuid>), never by users, but the local driver turns them into paths, so
// anything that could leave its folder is refused by every driver.
const safeKey = /^[A-Za-z0-9][\w-]*(\/[A-Za-z0-9][\w.-]*)*$/;

export const isSafeKey = (key: string) => safeKey.test(key) && !key.split("/").includes("..");

export const assertSafeKey = (key: string) => {
  if (!isSafeKey(key)) throw new Error(`Unsafe storage key: ${JSON.stringify(key)}`);
};
