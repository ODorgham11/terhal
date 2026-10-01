import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

// Add public pages here as they're built.
export default function sitemap(): MetadataRoute.Sitemap {
    return [
        { url: siteUrl, changeFrequency: "weekly", priority: 1 },
    ];
}
