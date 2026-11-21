import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { SIGNED_URL_LIFETIME, assertSafeKey, isSafeKey, type Storage } from "./storage";

// Where the API serves the local driver's files (src/http/router.ts mounts it with the local driver only).
export const LOCAL_FILES_PATH = "/v1/files";

interface LocalStorageOptions {
  // The folder files are written under.
  dir: string;
  // Signs the links (STORAGE_SIGNING_SECRET).
  secret: string;
  // The API's public address, e.g. https://api.local.terhal.co:8080.
  baseUrl: string;
  now?: () => number;
}

// Local development only (env.ts refuses it anywhere else): files are written to a folder, and a signed link points at
// the API's own route, which checks the signature and the expiry before serving the file. It behaves like the bucket's
// presigned links, so the rest of the app can't tell the difference.
export class LocalStorage implements Storage {
  readonly bucket = "local";
  readonly #files: string;
  readonly #types: string;
  readonly #secret: string;
  readonly #baseUrl: string;
  readonly #now: () => number;

  constructor({ dir, secret, baseUrl, now = Date.now }: LocalStorageOptions) {
    // Each file's content type is kept in a second tree, so a key can never collide with another key's metadata.
    this.#files = resolve(dir, "files");
    this.#types = resolve(dir, "types");
    this.#secret = secret;
    this.#baseUrl = baseUrl;
    this.#now = now;
  }

  #paths(key: string) {
    assertSafeKey(key);
    return { file: join(this.#files, key), type: join(this.#types, key) };
  }

  async put(key: string, body: Uint8Array, contentType: string) {
    const { file, type } = this.#paths(key);
    await Promise.all([
      mkdir(dirname(file), { recursive: true }),
      mkdir(dirname(type), { recursive: true }),
    ]);
    await writeFile(file, body);
    await writeFile(type, contentType);
  }

  async get(key: string) {
    const { file, type } = this.#paths(key);
    try {
      const [body, contentType] = await Promise.all([readFile(file), readFile(type, "utf8")]);
      return { body: new Uint8Array(body), contentType };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string) {
    const { file, type } = this.#paths(key);
    await Promise.all([rm(file, { force: true }), rm(type, { force: true })]);
  }

  #sign(key: string, expires: number) {
    return createHmac("sha256", this.#secret).update(`${key}\n${expires}`).digest("base64url");
  }

  signedUrl(key: string, expiresInSeconds = SIGNED_URL_LIFETIME) {
    assertSafeKey(key);
    const expires = Math.floor(this.#now() / 1000) + expiresInSeconds;
    const query = new URLSearchParams({
      key,
      expires: String(expires),
      signature: this.#sign(key, expires),
    });
    return Promise.resolve(`${this.#baseUrl}${LOCAL_FILES_PATH}?${query.toString()}`);
  }

  // Whether a link's query is one this storage signed and it hasn't expired. Never throws on bad input.
  verify({ key, expires, signature }: { key?: string; expires?: string; signature?: string }) {
    if (!key || !expires || !signature || !isSafeKey(key) || !/^\d{1,12}$/.test(expires)) {
      return false;
    }
    const expiresAt = Number(expires);
    if (expiresAt * 1000 <= this.#now()) return false;

    const expected = Buffer.from(this.#sign(key, expiresAt));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}
