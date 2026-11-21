import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // A self-contained server for the Docker image (see web/Dockerfile). Traced from the repo root, since the app pulls in
  // workspace packages.
  output: "standalone",
  // Shipped as TypeScript (packages/contracts).
  transpilePackages: ["@terhal/contracts"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Local development runs on https://local.terhal.co, https://dashboard.local.terhal.co and https://admin.local.terhal.co
  // (see the README), and Next only serves its dev assets to localhost unless told otherwise.
  allowedDevOrigins: ["local.terhal.co", "*.local.terhal.co"],
};

// Points next-intl at i18n/request.ts, which picks the locale from the NEXT_LOCALE cookie.
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withNextIntl(nextConfig);
