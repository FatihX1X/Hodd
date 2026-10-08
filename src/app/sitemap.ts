import type { MetadataRoute } from "next";
import { MARKETING_ORIGIN } from "@/lib/site/hosts";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: MARKETING_ORIGIN, changeFrequency: "monthly", priority: 1 }];
}
