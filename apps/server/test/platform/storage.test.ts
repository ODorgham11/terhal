import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { routes } from "../../src/http/router";
import { env } from "../../src/platform/config/env";
import { storage } from "../../src/platform/storage/index";
import { LocalStorage } from "../../src/platform/storage/local";
import { S3Storage } from "../../src/platform/storage/s3";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (body: Uint8Array) => new TextDecoder().decode(body);

describe("the local driver", () => {
  let dir: string;
  let now = Date.now();
  let local: LocalStorage;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "terhal-local-"));
    local = new LocalStorage({
      dir,
      secret: randomBytes(32).toString("base64"),
      baseUrl: "https://api.example.test",
      now: () => now,
    });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("puts, gets and deletes files with their content type", async () => {
    await local.put("vehicles/v1/a", bytes("hello"), "image/png");
    const file = await local.get("vehicles/v1/a");
    expect(file && text(file.body)).toBe("hello");
    expect(file?.contentType).toBe("image/png");

    await local.delete("vehicles/v1/a");
    expect(await local.get("vehicles/v1/a")).toBeNull();
    // Deleting it again is fine.
    await expect(local.delete("vehicles/v1/a")).resolves.toBeUndefined();
  });

  it("refuses keys that could leave its folder", async () => {
    for (const key of ["../escape", "a/../../b", "/absolute", "a//b", ""]) {
      await expect(local.put(key, bytes("x"), "text/plain")).rejects.toThrow(/Unsafe/);
    }
  });

  it("signs links that expire and can't be altered", async () => {
    const url = new URL(await local.signedUrl("vehicles/v1/b", 60));
    expect(url.origin + url.pathname).toBe("https://api.example.test/v1/files");
    const query = Object.fromEntries(url.searchParams);
    expect(local.verify(query)).toBe(true);

    expect(local.verify({ ...query, key: "vehicles/v1/c" })).toBe(false);
    expect(local.verify({ ...query, expires: String(Number(query.expires) + 3600) })).toBe(false);
    const signature = query.signature ?? "";
    const altered = (signature.startsWith("A") ? "B" : "A") + signature.slice(1);
    expect(local.verify({ ...query, signature: altered })).toBe(false);
    expect(local.verify({ key: query.key })).toBe(false);

    now += 61_000;
    expect(local.verify(query)).toBe(false);
  });
});

describe("GET /v1/files", () => {
  const pathOf = (url: string) => {
    const { pathname, search } = new URL(url);
    return pathname + search;
  };

  it("serves a file through its signed link", async () => {
    expect(env.STORAGE_DRIVER).toBe("local");
    await storage.put("tests/served", bytes("served"), "image/webp");

    const response = await routes.request(pathOf(await storage.signedUrl("tests/served")));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-site");
    expect(await response.text()).toBe("served");
  });

  it("refuses an altered or expired link", async () => {
    await storage.put("tests/guarded", bytes("guarded"), "image/png");
    const url = new URL(await storage.signedUrl("tests/guarded"));

    url.searchParams.set("key", "tests/served");
    expect((await routes.request(pathOf(url.href))).status).toBe(403);

    const expired = new URL(await storage.signedUrl("tests/guarded", -1));
    const response = await routes.request(pathOf(expired.href));
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe("FORBIDDEN");
  });

  it("answers 404 for a signed link to a file that's gone", async () => {
    const url = await storage.signedUrl("tests/missing");
    expect((await routes.request(pathOf(url))).status).toBe(404);
  });
});

describe("the s3 driver", () => {
  const options = {
    endpoint: "https://account.r2.cloudflarestorage.com",
    region: "auto",
    bucket: "terhal-test",
    accessKeyId: "test-key",
    secretAccessKey: "test-secret",
  };

  it("is configured for R2 from its options", async () => {
    const s3 = new S3Storage(options);
    expect(s3.bucket).toBe("terhal-test");
    expect(await s3.client.config.region()).toBe("auto");
    expect(s3.client.config.forcePathStyle).toBe(true);
    const endpoint = await s3.client.config.endpoint?.();
    expect(endpoint?.hostname).toBe("account.r2.cloudflarestorage.com");
    expect(await s3.client.config.credentials()).toMatchObject({
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
    });
  });

  it("presigns read links without the network", async () => {
    const s3 = new S3Storage(options);
    const url = new URL(await s3.signedUrl("vehicles/v1/a", 120));
    expect(url.origin).toBe("https://account.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/terhal-test/vehicles/v1/a");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("120");
    expect(url.searchParams.get("X-Amz-Credential")).toMatch(/^test-key\/\d{8}\/auto\/s3\//);
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("configuration", () => {
  // Loads env.ts in a fresh process, which exits when the variables are invalid.
  const start = (overrides: Record<string, string>) =>
    spawnSync(
      "pnpm",
      ["exec", "tsx", "-e", "import('./src/platform/config/env.ts').then(() => console.log('ok'))"],
      { env: { ...process.env, ...overrides }, encoding: "utf8" },
    );

  it("refuses the local driver outside local development", () => {
    const result = start({ APP_ENV: "staging", RESEND_KEY: "re_x", RESEND_EMAIL: "x@terhal.co" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("STORAGE_DRIVER");
  });

  it("needs every s3 key with the s3 driver", () => {
    const result = start({
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "https://account.r2.cloudflarestorage.com",
    });
    expect(result.status).toBe(1);
    for (const key of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
      expect(result.stderr).toContain(key);
    }
  });

  it("starts outside local development with the s3 driver and its keys", () => {
    const result = start({
      APP_ENV: "staging",
      RESEND_KEY: "re_x",
      RESEND_EMAIL: "x@terhal.co",
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "https://account.r2.cloudflarestorage.com",
      S3_BUCKET: "terhal-staging",
      S3_ACCESS_KEY_ID: "key",
      S3_SECRET_ACCESS_KEY: "secret",
    });
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("ok");
  });
});
