import type { MetadataRoute } from "next";
import { MARKETING_ORIGIN, MARKETING_PAGES } from "@/lib/site/hosts";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: MARKETING_ORIGIN, changeFrequency: "monthly", priority: 1 },
    ...MARKETING_PAGES.map((path) => ({ url: `${MARKETING_ORIGIN}${path}`, changeFrequency: "yearly" as const, priority: 0.3 })),
  ];
}
