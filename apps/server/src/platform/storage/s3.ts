import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { SIGNED_URL_LIFETIME, assertSafeKey, type Storage } from "./storage";

export interface S3StorageOptions {
  // For Cloudflare R2: https://<account id>.r2.cloudflarestorage.com
  endpoint: string;
  // "auto" for R2.
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

// Every outbound call has a timeout (docs/architecture.md, Failure handling). The SDK retries a failed call up to
// three times in all.
const CONNECTION_TIMEOUT = 5_000;
const REQUEST_TIMEOUT = 15_000;

export const createS3Client = ({
  endpoint,
  region,
  accessKeyId,
  secretAccessKey,
}: S3StorageOptions) =>
  new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    // Bucket in the path (endpoint/bucket/key), which every S3-compatible store supports; R2 doesn't need a DNS name
    // per bucket.
    forcePathStyle: true,
    // The SDK's newer default checksums aren't supported by every S3-compatible store; only send them where S3 requires
    // them.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 3,
    requestHandler: { connectionTimeout: CONNECTION_TIMEOUT, requestTimeout: REQUEST_TIMEOUT },
  });

// Staging and production: a private S3-compatible bucket (Cloudflare R2). Reads go through presigned links, made locally
// without a network call.
export class S3Storage implements Storage {
  readonly bucket: string;
  readonly client: S3Client;

  constructor(options: S3StorageOptions) {
    this.bucket = options.bucket;
    this.client = createS3Client(options);
  }

  async put(key: string, body: Uint8Array, contentType: string) {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string) {
    assertSafeKey(key);
    try {
      const object = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!object.Body) return null;
      return {
        body: await object.Body.transformToByteArray(),
        contentType: object.ContentType ?? "application/octet-stream",
      };
    } catch (error) {
      if (error instanceof NoSuchKey) return null;
      throw error;
    }
  }

  async delete(key: string) {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  signedUrl(key: string, expiresInSeconds = SIGNED_URL_LIFETIME) {
    assertSafeKey(key);
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }
}
