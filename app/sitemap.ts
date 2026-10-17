import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-09-06T00:00:00+10:00");

  return [
    {
      url: "https://magickeys-balwyn-portal.com",
      lastModified,
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: "https://magickeys-balwyn-portal.com/privacy",
      lastModified,
      changeFrequency: "yearly",
      priority: 0.8,
    },
    {
      url: "https://magickeys-balwyn-portal.com/terms",
      lastModified,
      changeFrequency: "yearly",
      priority: 0.7,
    },
  ];
}
