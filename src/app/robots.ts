import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { MARKETING_ORIGIN, siteForHost } from "@/lib/site/hosts";

// The landing page is public; the console and every other host stay out of search indexes.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host");
  if (siteForHost(host) === "marketing") return { rules: { userAgent: "*", allow: "/" }, sitemap: `${MARKETING_ORIGIN}/sitemap.xml` };
  return { rules: { userAgent: "*", disallow: "/" } };
}
