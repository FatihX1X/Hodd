import { describe, expect, it } from "vitest";
import { APP_ORIGIN, demoVideoUrl, isMarketingAsset, isMarketingPage, landingPathForHost, normalizeHost, siteForHost } from "./hosts";

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

  it("serves the legal pages on the marketing host", () => {
    for (const path of ["/terms", "/risk", "/privacy", "/terms/"]) expect(isMarketingPage(path)).toBe(true);
    for (const path of ["/", "/landing", "/termsx", "/terms/extra", "/login", "/waitlist"]) expect(isMarketingPage(path)).toBe(false);
    expect(landingPathForHost("hoddfinance.xyz")).toBe("/");
    expect(landingPathForHost("app.hoddfinance.xyz")).toBe("/landing");
    expect(landingPathForHost("localhost:3000")).toBe("/landing");
  });

  it("shows the demo video link only for an https address", () => {
    expect(demoVideoUrl("https://youtu.be/abc123")).toBe("https://youtu.be/abc123");
    expect(demoVideoUrl("  https://www.loom.com/share/x  ")).toBe("https://www.loom.com/share/x");
    for (const value of [undefined, null, "", "   ", "http://example.com/video", "javascript:alert(1)", "not a url", "/demo.mp4"]) expect(demoVideoUrl(value)).toBeNull();
  });
});
