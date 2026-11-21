import { config } from "dotenv";
import { z } from "zod";

// apps/server/.env holds local settings, including the local Postgres; the repo-root .env.local is written by
// `neon env pull` when you need to reach a Neon branch from your machine. Earlier files win, so comment out the two
// DATABASE_URL lines in apps/server/.env to use it. In the Docker image neither file exists and env is injected.
config({ path: [".env", "../../.env.local"], quiet: true });

// A secret of at least 256 bits (generate one with `openssl rand -base64 32`).
const secret = z.string().min(32, "Expected 32+ characters, e.g. openssl rand -base64 32");

const appEnv = z.enum(["development", "staging", "production"]).default("development");

// A blank value (e.g. `RESEND_KEY=` in an env file) means unset.
const blankIsUnset = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);
const optional = <T extends z.ZodType>(schema: T) => blankIsUnset(schema.optional());

// Each audience's frontend in this environment, e.g. https://admin.terhal.co. It is both the only browser origin allowed
// to call that audience's routes and the base of the links emailed to it. Local development (see the README) has
// defaults; everywhere else a missing one stops the process, so a link can never point at localhost in production.
const origin = (local: string) =>
  z
    .url()
    .transform((url) => url.replace(/\/+$/, ""))
    .optional()
    .transform((url, ctx) => {
      if (url) return url;
      if (appEnv.parse(process.env.APP_ENV) === "development") return local;
      ctx.addIssue({ code: "custom", message: "Required outside local development" });
      return z.NEVER;
    });

const schema = z
  .object({
    APP_ENV: appEnv,
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(8080),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    // The pooled URL at runtime; migrations use DATABASE_URL_UNPOOLED (prisma.config.ts).
    DATABASE_URL: z.url(),
    CACHE_URL: z.url(),
    QUEUE_URL: z.url(),
    SITE_URL: origin("https://local.terhal.co:3000"),
    DASHBOARD_URL: origin("https://dashboard.local.terhal.co:3000"),
    ADMIN_URL: origin("https://admin.local.terhal.co:3000"),
    // The header the edge proxy sets to the caller's address, used for per-IP rate limits. Only set it once a spoofed
    // value has been shown to be overwritten in that environment (see the README); unset, the socket address is used
    // (behind a proxy that is the proxy, so every client shares one limit: stricter, never looser).
    CLIENT_IP_HEADER: optional(
      z.string().regex(/^[a-z0-9-]+$/, "Expected a lowercase header name, e.g. x-real-ip"),
    ),
    // Local https (see the README). On the VPS the edge Caddy terminates TLS, so these are never set there.
    TLS_CERT: optional(z.string()),
    TLS_KEY: optional(z.string()),
    // Without a key, emails are printed to the console, which is only allowed in local development.
    RESEND_KEY: optional(z.string()),
    RESEND_EMAIL: optional(z.string()),
    // No defaults for secrets: a missing or short one stops the process instead of running insecurely.
    // Signs admin access tokens. Changing it signs every admin out.
    ADMIN_SECRET: secret,
    // Signs staff access tokens. Changing it signs every staff member out.
    STAFF_SECRET: secret,
    // Signs customer access tokens. Changing it signs every customer out.
    CUSTOMER_SECRET: secret,
    // Encrypts admins' two-factor secrets. Changing it breaks every admin's authenticator setup.
    TOTP_ENCRYPTION_KEY: secret,
    // Signs the drivers' report links. Changing it breaks every live link; staff then make new ones.
    REPORT_LINK_SECRET: secret,
    // Where uploaded files (vehicle images, monthly reports) are kept. `local` writes them to disk and is only allowed in
    // local development; everywhere else they go to an S3-compatible bucket (Cloudflare R2).
    STORAGE_DRIVER: blankIsUnset(z.enum(["local", "s3"]).default("local")),
    // The local driver's folder, relative to where the server runs (apps/server). Git-ignored.
    STORAGE_LOCAL_DIR: blankIsUnset(z.string().default(".storage")),
    // The API's public address, the base of the local driver's signed file links.
    STORAGE_LOCAL_URL: blankIsUnset(
      z
        .url()
        .default("https://api.local.terhal.co:8080")
        .transform((url) => url.replace(/\/+$/, "")),
    ),
    // Signs the local driver's file links. Required with the local driver.
    STORAGE_SIGNING_SECRET: optional(secret),
    // The s3 driver's bucket and keys. For R2 the endpoint is https://<account id>.r2.cloudflarestorage.com and the
    // region is auto.
    S3_ENDPOINT: optional(z.url()),
    S3_REGION: blankIsUnset(z.string().default("auto")),
    S3_BUCKET: optional(z.string()),
    S3_ACCESS_KEY_ID: optional(z.string()),
    S3_SECRET_ACCESS_KEY: optional(z.string()),
  })
  .superRefine((env, ctx) => {
    if (env.RESEND_KEY && !env.RESEND_EMAIL) {
      ctx.addIssue({ code: "custom", path: ["RESEND_EMAIL"], message: "Required with RESEND_KEY" });
    }
    if (!env.RESEND_KEY && env.APP_ENV !== "development") {
      ctx.addIssue({
        code: "custom",
        path: ["RESEND_KEY"],
        message: "Required outside local development",
      });
    }
    // Files on the server's disk would be lost on the next deploy, so only local development may use the local driver.
    if (env.STORAGE_DRIVER !== "s3" && env.APP_ENV !== "development") {
      ctx.addIssue({
        code: "custom",
        path: ["STORAGE_DRIVER"],
        message: "Must be s3 outside local development",
      });
    }
    if (env.STORAGE_DRIVER === "local" && !env.STORAGE_SIGNING_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["STORAGE_SIGNING_SECRET"],
        message: "Required with the local storage driver",
      });
    }
    if (env.STORAGE_DRIVER === "s3") {
      for (const key of [
        "S3_ENDPOINT",
        "S3_BUCKET",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "Required with the s3 storage driver",
          });
        }
      }
    }
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // console, not the logger: the logger is configured from these variables.
  console.error("Invalid environment variables:", z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export type Audience = "site" | "staff" | "admin";

export const origins = {
  site: env.SITE_URL,
  staff: env.DASHBOARD_URL,
  admin: env.ADMIN_URL,
} as const satisfies Record<Audience, string>;
