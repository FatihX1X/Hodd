/**
 * One deployment serves two sites:
 *  - the marketing site (landing page) on the apex domain
 *  - the treasury console (app) on the app subdomain
 *
 * Every other host (hodd.vercel.app, preview URLs, localhost) serves the console, so existing
 * wallet/passkey sessions and preview testing keep working. The landing page is always reachable
 * at /landing for previews.
 */
export const MARKETING_HOSTS = ["hoddfinance.xyz", "www.hoddfinance.xyz"] as const;
export const APP_HOST = "app.hoddfinance.xyz";
export const APP_ORIGIN = `https://${APP_HOST}`;
export const MARKETING_ORIGIN = `https://${MARKETING_HOSTS[0]}`;

export type SiteKind = "marketing" | "app";

/** Lower-cases a Host header value and drops the port. */
export function normalizeHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "");
}

export function siteForHost(host: string | null | undefined): SiteKind {
  const normalized = normalizeHost(host);
  return (MARKETING_HOSTS as readonly string[]).includes(normalized) ? "marketing" : "app";
}

/** Paths that exist only on the marketing host. Everything else belongs to the app host. */
export function isMarketingAsset(pathname: string): boolean {
  return pathname === "/robots.txt" || pathname === "/sitemap.xml" || pathname.startsWith("/brand/") || /^\/(?:icon|apple-icon|opengraph-image|twitter-image)(?:[-./]|$)/.test(pathname);
}

/** Public pages the marketing host serves next to the landing page (every other host serves them too). */
export const MARKETING_PAGES = ["/terms", "/risk", "/privacy"] as const;

export function isMarketingPage(pathname: string): boolean {
  return (MARKETING_PAGES as readonly string[]).includes(pathname.replace(/\/+$/, ""));
}

/** Where those pages link back to the landing page: the apex root on the marketing host, /landing elsewhere. */
export function landingPathForHost(host: string | null | undefined): string {
  return siteForHost(host) === "marketing" ? "/" : "/landing";
}

/** The hero's demo video link, from HODD_DEMO_VIDEO_URL. Only an absolute https address counts; anything else hides it. */
export function demoVideoUrl(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && url.hostname ? url.toString() : null;
  } catch {
    return null;
  }
}
