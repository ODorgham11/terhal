import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
    return {
        // The auth, admin, and staff pages have nothing worth indexing.
        rules: { userAgent: "*", allow: "/", disallow: ["/auth/", "/admin", "/dashboard"] },
        sitemap: `${siteUrl}/sitemap.xml`,
    };
}
