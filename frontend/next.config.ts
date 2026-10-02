import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Invitation links carry their token in the URL. no-referrer keeps the browser from passing that URL on
        // to any other site through the Referer header.
        source: "/auth/invite/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
