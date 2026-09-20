import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/brand", "/privacy", "/terms"],
      disallow: ["/login", "/api/"],
    },
    sitemap: "https://magickeys-balwyn-portal.com/sitemap.xml",
  };
}
