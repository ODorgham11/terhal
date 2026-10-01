import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
    return {
        // The auth pages have nothing worth indexing.
        rules: { userAgent: "*", allow: "/", disallow: "/auth/" },
        sitemap: `${siteUrl}/sitemap.xml`,
    };
}
