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
  await expect(page.locator("#top")).toContainText(/AI-run treasury\s*for small businesses/i);
  await expect(page.getByText("USYC is held by Hodd’s pool contract. Your pool shares redeem only to you.")).toBeVisible();
  const text = await page.locator("main").innerText();
  // Every move stays inside limits the user sets, so the page does not promise autonomy.
  expect(text).not.toMatch(/autonomous/i);
  // No ® anywhere: not in the ticker, the copy or the footer.
  expect(await page.locator("body").innerText()).not.toContain("®");
});

test("the demo video button stays hidden until its link is configured", async ({ page }) => {
  await page.goto("/landing");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("[data-demo-video]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /watch the demo/i })).toHaveCount(0);
});

test("the Claude section plays a question until the request lands in Hodd", async ({ page }) => {
  // The scene takes about seven seconds of real time; leave room for a busy machine.
  test.setTimeout(60_000);
  await page.goto("/landing");
  const section = page.locator("#claude");
  await section.evaluate((element) => element.scrollIntoView({ block: "start", behavior: "instant" }));
  await expect(section.getByRole("heading", { level: 2, name: /use hodd\s*from claude\./i })).toBeVisible();
  // The whole conversation, with the connector's real tool names, is there for screen readers.
  await expect(section.getByText(/^Claude: \(uses hodd_check_payment\)/)).toBeAttached();
  await expect(section.getByText(/^Claude: \(uses hodd_prepare_change, hodd_request_payment\)/)).toBeAttached();
  const steps = section.locator("ol:not(.sr-only) > li");
  await expect(steps).toHaveCount(3);
  // Claude answers with Hodd's tools, then the request waits in Hodd for a wallet signature. The steps light up in turn.
  const seen = new Set<number>();
  await expect.poll(async () => {
    const index = (await steps.evaluateAll((items) => items.map((item) => item.getAttribute("data-active")))).indexOf("true");
    if (index >= 0) seen.add(index);
    return seen.has(2);
  }, { timeout: 40_000, intervals: [200] }).toBe(true);
  expect(seen.has(1), "Claude reads Hodd before the request lands").toBe(true);
  await expect(section.getByText("1 open", { exact: true })).toBeVisible();
  await expect(section.getByText("Pay October rent", { exact: true })).toBeVisible();
});

test("the proof section links to ArcScan, the Circle record and CI", async ({ page }) => {
  await page.goto("/landing");
  const proof = page.locator("#proof");
  await proof.scrollIntoViewIfNeeded();
  await expect(proof.getByRole("heading", { level: 2, name: /proof,\s*not promises\./i })).toBeVisible();
  const arcscan = {
    HoddieVaultFactory: "https://testnet.arcscan.app/address/0x311578B21F269ca0E45f5c16324A3E51f69ce389",
    HoddUSYCVault: "https://testnet.arcscan.app/address/0x97A7BAaA5416e0aC0674C395cec22FF606120b76",
    "Autopilot’s first bill payment": "https://testnet.arcscan.app/tx/0x35ca2d3c7b45b55a32a1b9aec31c70f292259efc71edbe8763374a46c09d796b",
  };
  for (const [name, href] of Object.entries(arcscan)) {
    const link = proof.getByRole("link", { name: new RegExp(`^${name}`, "i") });
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  }
  await expect(proof.getByText("Allowlisted by Circle")).toBeVisible();
  await expect(proof.getByRole("link", { name: /read the validation record/i })).toHaveAttribute("href", "https://github.com/FatihX1X/Hodd/blob/main/docs/usyc-validation.md");
  await expect(proof.locator('a[href="https://github.com/FatihX1X/Hodd/actions/workflows/ci.yml"]')).toBeVisible();
  await expect(proof.getByText(/production totals on arc testnet, as of oct 15, 2026/i)).toBeVisible();
  await expect(proof.locator("dl dd")).toHaveCount(6);
});

test("built for, built on and the FAQ say what Hodd is for", async ({ page }) => {
  await page.goto("/landing");
  const audiences = page.locator("#built-for li h3");
  await expect(audiences).toHaveText([/small business payroll/i, /freelancer rent and bills/i, /contractor payouts/i]);
  await expect(page.locator("#built-on li")).toHaveText([/circle wallets/i, /gas station/i, /app kit/i, /gateway/i, /usyc/i, /contracts/i, /morpho/i, /^arc$/i]);

  const faq = page.locator("#faq details");
  await expect(faq).toHaveCount(4);
  const custody = faq.filter({ hasText: /can hodd take my money\?/i });
  const answer = custody.getByText(/send money to four places only/);
  await expect(answer).toBeHidden();
  await custody.locator("summary").click();
  await expect(answer).toBeVisible();
  // The rows are native disclosures, so the keyboard works too.
  const testnet = faq.filter({ hasText: /why testnet\?/i });
  await testnet.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(testnet.getByText(/not audited yet/)).toBeVisible();
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
  await expect(section.getByText(/only send money to Morpho, Hodd’s USYC pool, bills you approved and your own wallet/)).toBeVisible();
  // Autopilot's own decision kinds; it pays only bills the owner approved.
  for (const verdict of ["INVEST", "PAY", "TOP UP", "REFILL", "RETURN", "HOLD"]) await expect(section.getByText(new RegExp(`^${verdict}:`)).first()).toBeAttached();
  await expect(section.getByText(/^ESCALATE:/)).toHaveCount(0);
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
    // Claude: the whole conversation and the request already waiting in Hodd, with no step singled out.
    const claude = page.locator("#claude");
    await claude.scrollIntoViewIfNeeded();
    await expect(claude.getByText("Send it to Hodd for Friday.", { exact: true })).toBeVisible();
    await expect(claude.getByText("1 open", { exact: true })).toBeVisible();
    await expect(claude.getByText("Pay October rent", { exact: true })).toBeVisible();
    await expect(claude.locator("li[data-active]")).toHaveCount(0);
    await expect(page.locator("#proof").getByText("Allowlisted by Circle")).toBeVisible();
  });
});

test("mobile layout keeps every scene inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/landing");
  for (const id of ["top", "how", "hoddie", "claude", "proof", "built-for", "built-on", "faq"]) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), id).toBe(false);
  }
  // One column: the Claude steps sit above the conversation, not beside it.
  const steps = await page.locator("#claude ol:not(.sr-only)").boundingBox();
  const chat = await page.locator('#claude section[aria-label^="Example conversation"]').boundingBox();
  expect(chat!.y).toBeGreaterThan(steps!.y + steps!.height);
});

test("the footer links to the legal pages, X and email", async ({ page }) => {
  await page.goto("/landing");
  const footer = page.getByRole("navigation", { name: "Footer" });
  const x = footer.getByRole("link", { name: /^X @hoddfinance/ });
  await expect(x).toHaveAttribute("href", "https://x.com/hoddfinance");
  await expect(x).toHaveAttribute("target", "_blank");
  await expect(x).toHaveAttribute("rel", /noopener/);
  await expect(footer.getByRole("link", { name: "info@hoddfinance.xyz" })).toHaveAttribute("href", "mailto:info@hoddfinance.xyz");
  // No plain GitHub link anywhere; GitHub appears only behind the Proof section's CI badge and validation record.
  await expect(footer.getByRole("link", { name: /github/i })).toHaveCount(0);
  await expect(page.locator('a[href="https://github.com/FatihX1X/Hodd"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: /code on github/i })).toHaveCount(0);
  for (const [name, href] of [["Terms", "/terms"], ["Risk", "/risk"], ["Privacy", "/privacy"]]) {
    await expect(footer.getByRole("link", { name: new RegExp(`^${name}$`, "i") })).toHaveAttribute("href", href);
  }
  await expect(page.locator('a[href*="waitlist"]')).toHaveCount(0);
  await expect(page.locator("footer")).not.toContainText("®");
  expect(await page.content()).not.toContain("hello@hoddfinance.xyz");
});

test("the legal pages disclaim liability, speak as Hodd Finance and link back home", async ({ page }) => {
  for (const [path, title] of [["/terms", /^terms$/i], ["/risk", /^risk$/i], ["/privacy", /^privacy$/i]] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole("link", { name: "Hodd Finance, home" })).toHaveAttribute("href", "/landing");
    await expect(page.getByRole("link", { name: "info@hoddfinance.xyz" })).toHaveAttribute("href", "mailto:info@hoddfinance.xyz");
    const text = await page.locator("main").textContent() ?? "";
    expect(text, path).toContain("Hodd Finance");
    // The company is only ever "Hodd Finance", never "we", "us" or "our".
    expect(text, path).not.toMatch(/\b(we|us|our|ours)\b/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), path).toBe(false);
  }
  await page.goto("/terms");
  await expect(page.locator("main")).toContainText(/“as is”/);
  await expect(page.locator("main")).toContainText(/not liable/);
  await page.goto("/risk");
  await expect(page.locator("main")).toContainText(/entirely at your own risk/);
});

test("the closing section shows a single star", async ({ page }) => {
  await page.goto("/landing");
  const cta = page.locator("#cta");
  await cta.scrollIntoViewIfNeeded();
  await expect(cta.locator("img")).toHaveCount(1);
  await expect(cta.getByText("Hodd Finance", { exact: true })).toHaveCount(0);
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

  // The legal pages live next to the landing page and link back to the apex root; there is no waitlist page.
  expect((await request.get("/waitlist", { headers: host, maxRedirects: 0 })).status()).toBe(308);
  for (const path of ["/terms", "/risk", "/privacy"]) {
    const response = await request.get(path, { headers: host, maxRedirects: 0 });
    expect(response.status(), path).toBe(200);
    expect(await response.text(), path).toContain('<a href="/" aria-label="Hodd Finance, home"');
  }
  const sitemap = await request.get("/sitemap.xml", { headers: host });
  expect(await sitemap.text()).toContain("https://hoddfinance.xyz/privacy");

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

test("the hero intro plays once per tab, never for reduced motion, and leaves the mark as the lockup", async ({ page, browser }) => {
  await page.goto("/landing");
  const hero = page.locator("#top");
  await expect(hero).toHaveAttribute("data-intro", "play");
  await expect(page.getByRole("heading", { level: 1, name: /your capital,\s*ahead of time\./i })).toBeVisible();
  // The star glides in on the shared clock; at rest it sits where the lockup's own star was.
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.timeline instanceof DocumentTimeline && !(a instanceof CSSAnimation)).length)).toBeGreaterThan(5);
  await page.reload();
  await expect(hero).not.toHaveAttribute("data-intro", /.+/);
  const reduced = await browser.newPage({ reducedMotion: "reduce" });
  await reduced.goto("/landing");
  await expect(reduced.locator("#top")).not.toHaveAttribute("data-intro", /.+/);
  await reduced.waitForTimeout(1500);
  expect(await reduced.evaluate(() => document.getAnimations().filter((a) => a.timeline instanceof DocumentTimeline && a.playState === "running" && (a.effect as KeyframeEffect | null)?.target?.closest("#top img, #top [aria-hidden]")).length)).toBe(0);
  await reduced.close();
});
