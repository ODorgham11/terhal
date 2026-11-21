import type { Context } from "hono";
import { env } from "../config/env";
import { AppError } from "../errors/app-error";
import { LocalStorage } from "./local";
import { S3Storage } from "./s3";
import type { Storage } from "./storage";

export { LOCAL_FILES_PATH } from "./local";
export { SIGNED_URL_LIFETIME, type Storage, type StoredFile } from "./storage";

// The one storage the app uses, picked by STORAGE_DRIVER. env.ts has already checked the chosen driver's settings, and
// refuses the local driver outside local development.
const createStorage = (): Storage => {
  if (env.STORAGE_DRIVER === "s3") {
    return new S3Storage({
      endpoint: env.S3_ENDPOINT ?? "",
      region: env.S3_REGION,
      bucket: env.S3_BUCKET ?? "",
      accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
    });
  }
  return new LocalStorage({
    dir: env.STORAGE_LOCAL_DIR,
    secret: env.STORAGE_SIGNING_SECRET ?? "",
    baseUrl: env.STORAGE_LOCAL_URL,
  });
};

export const storage = createStorage();

// Serves the local driver's signed links (GET /v1/files?key&expires&signature), like the bucket serves presigned ones.
// Mounted only with the local driver.
export const serveLocalFile = async (c: Context) => {
  const forbidden = new AppError({
    code: "FORBIDDEN",
    status: 403,
    detail: "This link is invalid or has expired.",
  });
  if (!(storage instanceof LocalStorage)) throw forbidden;

  const query = c.req.query();
  if (!storage.verify(query)) throw forbidden;

  // verify() checked the key is there.
  const file = await storage.get(query.key ?? "");
  if (!file) {
    throw new AppError({ code: "NOT_FOUND", status: 404, detail: "There's no such file." });
  }

  return c.body(file.body, 200, {
    "Content-Type": file.contentType,
    "Cache-Control": "private, max-age=300",
  });
};
