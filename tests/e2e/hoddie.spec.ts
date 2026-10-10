import { expect, test } from "@playwright/test";
import { liveSession } from "./live-session";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/earn/portfolio*", (route) => route.fulfill({ json: { status: "READY", integration: { discovery: "READY", positionAccess: "NOT_CONFIGURED", execution: "READ_ONLY", configuredWalletAddress: null, message: "Read only" }, vaults: [], positions: [], observedAt: "2026-10-08T12:00:00Z" } }));
});
test("Hoddie navigation and read-only setup reflow without console errors", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message)); page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await liveSession(page);
  await page.route("**/api/hoddie/consent*", route => route.fulfill({ json: { status: "READY", allowed: false } }));
  await page.goto("/hoddie"); await expect(page.getByRole("heading", { name: "Hoddie", exact: true })).toBeVisible();
  await expect(page.locator('[data-theme="dark"]')).toBeVisible();
  await expect(page.getByRole("region", { name: "Hoddie conversation" })).toHaveCSS("background-color", "rgb(16, 19, 25)");
  if (testInfo.project.name === "desktop") {
    await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Hoddie", exact: true })).toHaveAttribute("aria-current", "page");
  }
  await expect(page.getByRole("combobox", { name: "Command provider" })).toHaveCount(0);
  const suggestions = page.getByRole("region", { name: "Suggested commands" });
  // The wide chat fits every suggestion at 1280px; the arrows matter once the row overflows.
  await page.setViewportSize({ width: 1024, height: 900 });
  expect(await suggestions.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.getByRole("button", { name: "Next suggestions" }).click();
  expect(await suggestions.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Previous suggestions" }).click();
  await expect(page.getByRole("button", { name: "Send command" })).toBeDisabled();
  await page.getByRole("button", { name: "Summarize my treasury" }).click(); await expect(page.getByLabel("Your command")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("hoddie-compact-chat.png"), fullPage: true });
  for (const width of [320, 375, 640]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    const navigation = page.getByRole("navigation", { name: "Mobile navigation" });
    await expect(navigation.getByRole("link")).toHaveCount(8);
    for (const label of ["Overview", "Strategies", "Obligations", "Policy", "Activity", "Connections", "Autopilot", "Hoddie"]) {
      await expect(navigation.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    await expect(navigation.getByRole("link", { name: "Hoddie", exact: true })).toHaveAttribute("aria-current", "page");
  }
  expect(errors).toEqual([]);
});
test("mocked interpretation shows sourced cards, user-only confirmation and session-only history", async ({ page }, testInfo) => {
  await liveSession(page);
  let allowed = false; let confirms = 0; const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/hoddie/consent*", (route) => {
    if (route.request().method() === "POST") allowed = true;
    if (route.request().method() === "DELETE") allowed = false;
    return route.fulfill({ json: { status: "READY", allowed } });
  });
  await page.route("**/api/hoddie/chat", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { status: "READY", providers: [{ id: "GEMINI", model: "mock-intent-provider", ready: true, label: "Gemini", note: "Test only" }] } });
    bodies.push(route.request().postDataJSON());
    const result = { language: "en", message: "Canonical server result", source: "NOT_CONNECTED", observedAt: "2026-10-08T12:00:00Z", cards: [{ title: "Treasury overview", fields: [{ label: "Deployable capital", value: "4500 USDC" }] }], proposal: { handle: "mock-review", kind: "UPDATE_POLICY", summary: "Safety buffer 1000 → 1500 USDC", lines: ["Not yet applied"], expiresAt: new Date(Date.now() + 600000).toISOString(), impact: [{ label: "Deployable capital", before: "4500 USDC", after: "4000 USDC" }] } };
    const chunks = [{ type: "start", messageId: crypto.randomUUID() }, { type: "data-hoddie", data: result }, { type: "finish" }];
    return route.fulfill({ contentType: "text/event-stream", headers: { "x-vercel-ai-ui-message-stream": "v1" }, body: chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n" });
  });
  await page.route("**/api/hoddie/confirm", (route) => { confirms++; return route.fulfill({ json: { status: "READY", request: false } }); });
  await page.goto("/hoddie"); await page.getByRole("button", { name: "Allow Hoddie for this session" }).click();
  await page.getByLabel("Your command").fill("Güvenlik tamponunu 1500 USDC olarak değiştir"); await page.getByRole("button", { name: "Send command" }).click();
  await expect(page.getByText("4500 USDC", { exact: true })).toBeVisible(); expect(confirms).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("hoddie-change-review.png"), fullPage: true });
  expect(bodies[0]).toMatchObject({ mode: "MESSAGE", message: "Güvenlik tamponunu 1500 USDC olarak değiştir", provider: "AUTO" });
  expect(bodies[0]).not.toHaveProperty("messages"); expect(JSON.stringify(bodies[0])).not.toContain("4500");
  const apply = page.getByRole("button", { name: "Apply change" }); await apply.focus(); await apply.press("Enter");
  await expect(apply).toBeDisabled(); expect(confirms).toBe(1);
  await page.getByRole("link", { name: "Overview", exact: true }).filter({ visible: true }).first().click(); await page.goto("/hoddie");
  // A full document navigation deliberately clears memory; SPA navigation is tested below.
  await expect(page.getByText("Canonical server result")).toHaveCount(0);
  await page.getByLabel("Your command").fill("Update safety buffer to 1500 USDC"); await page.getByRole("button", { name: "Send command" }).click();
  await expect(page.getByText("Canonical server result")).toBeVisible();
  await page.getByRole("link", { name: "Overview", exact: true }).filter({ visible: true }).first().click();
  await page.getByRole("link", { name: /^(Open )?Hoddie$/ }).filter({ visible: true }).first().click(); await expect(page.getByText("Canonical server result")).toBeVisible();
  await page.reload(); await expect(page.getByText("Canonical server result")).toHaveCount(0);
});

test("disconnected signed-in accounts answer locally in English and Turkish without interpretation or writes", async ({ page }, testInfo) => {
  await liveSession(page);
  const width = testInfo.project.name === "desktop" ? 1280 : 375;
  await page.setViewportSize({ width, height: 900 });
  const posts: string[] = [];
  await page.route("**/api/hoddie/**", (route) => {
    if (route.request().method() !== "GET") posts.push(route.request().url());
    return route.fulfill({ json: { status: "READY", providers: [{ id: "GEMINI", ready: true }] } });
  });
  await page.goto("/hoddie");
  await page.getByLabel("Your command").fill("Summarize my treasury"); await page.getByRole("button", { name: "Send command" }).click();
  const log = page.getByRole("log", { name: "Conversation messages" });
  await expect(log).toContainText("0.00 USDC"); await expect(log).toContainText("NOT CONNECTED");
  const logHeight = (await log.boundingBox())?.height; expect(logHeight).toBeGreaterThan(0);
  await expect(log.getByRole("navigation", { name: "Answer sources" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: "test-results/hoddie-disconnected-" + width + ".png", fullPage: true, scale: "css" });
  await page.getByLabel("Your command").fill("Hesabımı özetle"); await page.getByRole("button", { name: "Send command" }).click();
  await expect(log).toContainText("Hazinenizde 0.00 USDC var"); await expect(log).toContainText("Toplam hazine");
  await page.getByLabel("Your command").fill("Create a 500 USDC obligation due tomorrow"); await page.getByRole("button", { name: "Send command" }).click();
  await expect(log).toContainText("cannot change it or move funds");
  // The log is a fixed-height scroll area: more messages must not grow the panel or the page.
  expect((await log.boundingBox())?.height).toBe(logHeight); await expect(log).toHaveAttribute("tabindex", "0");
  await expect(page.getByRole("button", { name: "Apply change" })).toHaveCount(0);
  expect(posts).toEqual([]); await expect(page.getByRole("main")).not.toContainText(/Gemini|OpenRouter|NVIDIA|Nemotron/);
  await page.goto("/"); await expect(page.getByRole("heading", { name: "Your live testnet treasury", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: "test-results/overview-disconnected-" + width + ".png", fullPage: true });
});
