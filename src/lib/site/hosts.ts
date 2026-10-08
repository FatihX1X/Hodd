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
