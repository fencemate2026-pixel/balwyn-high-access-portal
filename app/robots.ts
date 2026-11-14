import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/privacy", "/terms"],
      disallow: ["/login", "/api/", "/classroom"],
    },
    sitemap: "https://magickeys-balwyn-portal.com/sitemap.xml",
  };
}
