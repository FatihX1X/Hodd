import { expect, test } from "@playwright/test";

test("landing page is reachable at /landing on any host and does not overflow", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/landing");
  await expect(page).toHaveTitle(/Hodd Finance/);
  await expect(page.getByRole("heading", { level: 1, name: /your capital,\s*ahead of time/i })).toBeVisible();
  // Same-origin hosts (previews, localhost) link straight into the console.
  await expect(page.getByRole("link", { name: /launch app/i }).first()).toHaveAttribute("href", "/");
  await expect(page.getByRole("link", { name: /try the demo/i })).toHaveCount(0);
  await expect(page.getByText("Live Arc Testnet wallet balance")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  expect(errors).toEqual([]);
});

test("landing copy matches what ships today", async ({ page }) => {
  await page.goto("/landing");
  await expect(page).toHaveTitle("Hodd Finance — Treasury that plans ahead");
  await expect(page.getByRole("heading", { level: 2, name: /proactive\.\s*never\s*unaccountable\./i })).toBeVisible();
  const text = await page.locator("main").innerText();
  // Every move stays inside limits the user sets, so the page does not promise autonomy, and the principle has no ® mark.
  expect(text).not.toMatch(/autonomous/i);
  expect(text).not.toMatch(/unaccountable\.?\s*®/);
});

test("the hero treasury loops through all six moves", async ({ page }) => {
  await page.goto("/landing");
  const treasury = page.locator("[data-step]");
  await treasury.scrollIntoViewIfNeeded();
  const seen = new Set<string>();
  await expect.poll(async () => {
    seen.add((await treasury.getAttribute("data-step")) ?? "");
    return seen.size;
  }, { timeout: 20_000, intervals: [400] }).toBeGreaterThanOrEqual(6);
  expect([...seen].sort()).toEqual(["bill", "income", "morpho", "paid", "protect", "withdraw"]);
  // The story is also available as text for screen readers.
  await expect(page.getByText(/6,200 USDC is paid on time with the buffer intact/)).toBeAttached();
});

test("the how-it-works timeline follows the scroll on wide screens", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The pinned timeline is a wide-screen layout.");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/landing");
  const steps = page.locator("#how ol > li");
  await expect(steps).toHaveCount(4);
  await steps.first().scrollIntoViewIfNeeded();
  await expect(steps.first()).toHaveAttribute("data-active", "true");
  await steps.last().evaluate((element) => element.scrollIntoView({ block: "center" }));
  await expect(steps.last()).toHaveAttribute("data-active", "true");
  await expect(steps.first()).toHaveAttribute("data-active", "false");
});

test("the Hoddie section shows Hoddie and Autopilot's real decisions", async ({ page }) => {
  await page.goto("/landing");
  const section = page.locator("#hoddie");
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole("heading", { level: 2, name: /ask first\.\s*automate later\./i })).toBeVisible();
  await expect(section.getByText("Available now")).toBeVisible();
  await expect(section.getByText("Arc Testnet", { exact: true })).toBeVisible();
  await expect(section.getByText(/only invest in the allowlisted Morpho vault or return USDC to your verified wallet/)).toBeVisible();
  // Autopilot's own decision kinds; it never pays third parties.
  for (const verdict of ["INVEST", "TOP UP", "REFILL", "RETURN", "HOLD"]) await expect(section.getByText(new RegExp(`^${verdict}:`)).first()).toBeAttached();
  await expect(section.getByText(/^(PAY|ESCALATE):/)).toHaveCount(0);
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("every scene renders still and complete", async ({ page }) => {
    await page.goto("/landing");
    const treasury = page.locator("[data-step]");
    await treasury.scrollIntoViewIfNeeded();
    await expect(treasury).toHaveAttribute("data-step", "paid");
    await page.waitForTimeout(3_000);
    await expect(treasury).toHaveAttribute("data-step", "paid");
    const section = page.locator("#hoddie");
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByText("Prepare it.", { exact: true })).toBeVisible();
    await expect(section.getByText("Withdraw 600 USDC from Morpho", { exact: true })).toBeVisible();
    await expect(page.locator("#how ol > li[data-active]")).toHaveCount(0);
  });
});

test("mobile layout keeps every scene inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/landing");
  for (const id of ["top", "how", "hoddie"]) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), id).toBe(false);
  }
});

test("system tabs describe live features", async ({ page }) => {
  await page.goto("/landing");
  const liquidity = page.getByRole("button", { name: /02\s*liquidity/i });
  await liquidity.scrollIntoViewIfNeeded();
  await liquidity.click();
  await expect(liquidity).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Protect bills before yield" })).toBeVisible();
  await page.getByRole("button", { name: /03\s*obligations/i }).click();
  await expect(page.getByRole("heading", { name: "Your bills, your approval" })).toBeVisible();
});

test("the marketing host serves the landing page and nothing else", async ({ request }) => {
  const host = { host: "hoddfinance.xyz" };
  const home = await request.get("/", { headers: host, maxRedirects: 0 });
  expect(home.status()).toBe(200);
  expect(await home.text()).toContain("Your capital,");

  // The landing page links to the console on its own subdomain.
  expect(await home.text()).toContain('href="https://app.hoddfinance.xyz/"');

  expect(await home.text()).not.toContain("?demo=1");

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
  expect(await home.text()).toContain("Loading treasury workspace");
  const robots = await request.get("/robots.txt", { headers: host });
  expect(await robots.text()).toMatch(/Disallow:\s*\//);
  const marketingRobots = await request.get("/robots.txt", { headers: { host: "hoddfinance.xyz" } });
  expect(await marketingRobots.text()).toMatch(/Allow:\s*\//);
});
