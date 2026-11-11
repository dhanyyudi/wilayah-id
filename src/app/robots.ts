import type { MetadataRoute } from "next";

/**
 * The website pages are for search engines; the JSON API and the vector tiles
 * are not. Without this file crawlers fetch /api/v1/... and report each answer
 * as a page they could not index.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/tiles/"],
    },
  };
}
