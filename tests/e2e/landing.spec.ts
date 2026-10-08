import { expect, test } from "@playwright/test";

test("landing page is reachable at /landing on any host and does not overflow", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/landing");
  await expect(page).toHaveTitle(/Hodd Finance/);
  await expect(page.getByRole("heading", { level: 1, name: /your capital,\s*ahead of time/i })).toBeVisible();
  // Same-origin hosts (previews, localhost) link straight into the console.
  await expect(page.getByRole("link", { name: /launch app/i }).first()).toHaveAttribute("href", "/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  expect(errors).toEqual([]);
});

test("system tabs switch the illustrative panel", async ({ page }) => {
  await page.goto("/landing");
  const liquidity = page.getByRole("button", { name: /02\s*liquidity/i });
  await liquidity.scrollIntoViewIfNeeded();
  await liquidity.click();
  await expect(liquidity).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Liquidity position")).toBeVisible();
  await page.getByRole("button", { name: /03\s*obligations/i }).click();
  await expect(page.getByText("Upcoming obligations")).toBeVisible();
});

test("the marketing host serves the landing page and nothing else", async ({ request }) => {
  const host = { host: "hoddfinance.xyz" };
  const home = await request.get("/", { headers: host, maxRedirects: 0 });
  expect(home.status()).toBe(200);
  expect(await home.text()).toContain("Your capital,");

  // The landing page links to the console on its own subdomain.
  expect(await home.text()).toContain('href="https://app.hoddfinance.xyz/"');

  const consolePage = await request.get("/invest?tab=vaults", { headers: host, maxRedirects: 0 });
  expect(consolePage.status()).toBe(308);
  expect(consolePage.headers().location).toBe("https://app.hoddfinance.xyz/invest?tab=vaults");

  const login = await request.get("/login", { headers: host, maxRedirects: 0 });
  expect(login.status()).toBe(308);
  expect(login.headers().location).toBe("https://app.hoddfinance.xyz/login");

  const canonical = await request.get("/landing", { headers: host, maxRedirects: 0 });
  expect(canonical.status()).toBe(308);

  for (const path of ["/api/payments", "/api/earn/quote", "/api/wallet/circle/session"]) {
    const response = await request.post(path, { headers: host, data: {}, maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
  }
});

test("the app host serves the console and stays out of search indexes", async ({ request }) => {
  const host = { host: "app.hoddfinance.xyz" };
  const home = await request.get("/", { headers: host, maxRedirects: 0 });
  expect(home.status()).toBe(200);
  expect(await home.text()).toContain("Liquidity before yield.");
  const robots = await request.get("/robots.txt", { headers: host });
  expect(await robots.text()).toMatch(/Disallow:\s*\//);
  const marketingRobots = await request.get("/robots.txt", { headers: { host: "hoddfinance.xyz" } });
  expect(await marketingRobots.text()).toMatch(/Allow:\s*\//);
});
