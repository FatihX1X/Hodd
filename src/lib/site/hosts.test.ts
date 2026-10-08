import { describe, expect, it } from "vitest";
import { APP_ORIGIN, isMarketingAsset, normalizeHost, siteForHost } from "./hosts";

describe("site hosts", () => {
  it("serves the landing page on the apex and www hosts only", () => {
    expect(siteForHost("hoddfinance.xyz")).toBe("marketing");
    expect(siteForHost("www.hoddfinance.xyz")).toBe("marketing");
    expect(siteForHost("HODDFINANCE.xyz:443")).toBe("marketing");
  });

  it("serves the console on the app host and every other host", () => {
    expect(siteForHost("app.hoddfinance.xyz")).toBe("app");
    expect(siteForHost("hodd.vercel.app")).toBe("app");
    expect(siteForHost("hodd-git-feature-fatihx1xs-projects.vercel.app")).toBe("app");
    expect(siteForHost("127.0.0.1:3107")).toBe("app");
    expect(siteForHost("localhost:3000")).toBe("app");
    expect(siteForHost(null)).toBe("app");
  });

  it("does not treat look-alike hosts as the marketing site", () => {
    expect(siteForHost("hoddfinance.xyz.evil.example")).toBe("app");
    expect(siteForHost("evilhoddfinance.xyz")).toBe("app");
  });

  it("normalizes host headers", () => {
    expect(normalizeHost(" App.HoddFinance.xyz:8080 ")).toBe("app.hoddfinance.xyz");
    expect(normalizeHost(undefined)).toBe("");
    expect(APP_ORIGIN).toBe("https://app.hoddfinance.xyz");
  });

  it("recognises public marketing assets", () => {
    for (const path of ["/robots.txt", "/sitemap.xml", "/brand/hodd-star.png", "/icon.png", "/apple-icon.png", "/opengraph-image.png"]) expect(isMarketingAsset(path)).toBe(true);
    for (const path of ["/", "/login", "/api/payments", "/invest", "/iconography"]) expect(isMarketingAsset(path)).toBe(false);
  });
});
