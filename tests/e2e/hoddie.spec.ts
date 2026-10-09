import { expect, test } from "@playwright/test";
import { initialWorkspace } from "../../src/lib/treasury/fixtures";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/earn/portfolio*", (route) => route.fulfill({ json: { status: "READY", integration: { discovery: "READY", positionAccess: "NOT_CONFIGURED", execution: "READ_ONLY", configuredWalletAddress: null, message: "Read only" }, vaults: [], positions: [], observedAt: "2026-10-08T12:00:00Z" } }));
});
test("Hoddie navigation and read-only setup reflow without console errors", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message)); page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  // Signed-out visitors get the live welcome gate; the read-only demo shows the assistant layout.
  await page.goto("/hoddie?demo=1"); await expect(page.getByRole("heading", { name: "Hoddie", exact: true })).toBeVisible();
  await expect(page.locator('[data-theme="dark"]')).toBeVisible();
  await expect(page.getByRole("region", { name: "Hoddie conversation" })).toHaveCSS("background-color", "rgb(16, 19, 25)");
  if (testInfo.project.name === "desktop") {
    await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Hoddie", exact: true })).toHaveAttribute("aria-current", "page");
  }
  await expect(page.getByRole("combobox", { name: "Command provider" })).toHaveCount(0);
  const suggestions = page.getByRole("region", { name: "Suggested commands" });
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
    await expect(navigation.getByRole("link")).toHaveCount(7);
    for (const label of ["Overview", "Strategies", "Obligations", "Policy", "Activity", "Connections", "Hoddie"]) {
      await expect(navigation.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    await expect(navigation.getByRole("link", { name: "Hoddie", exact: true })).toHaveAttribute("aria-current", "page");
  }
  expect(errors).toEqual([]);
});
test("mocked interpretation shows sourced cards, user-only confirmation and session-only history", async ({ page }, testInfo) => {
  // Synthetic browser session only; every Supabase request is intercepted below.
  const user = { id: "11111111-1111-4111-8111-111111111111", email: "hoddie-e2e@example.invalid", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, created_at: "2026-10-08T12:00:00Z" };
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, aud: "authenticated", role: "authenticated", exp: expiry })).toString("base64url")}.mock-signature`;
  const session = { access_token: token, refresh_token: "synthetic-test-only", token_type: "bearer", expires_in: 3600, expires_at: expiry, user };
  await page.context().addCookies([{ name: "sb-lbdtfzyulgegpsxhszfw-auth-token", value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`, domain: "127.0.0.1", path: "/" }]);
  await page.route("https://*.supabase.co/**", (route) => {
    const url = route.request().url();
    if (url.includes("/auth/v1/user")) return route.fulfill({ json: user });
    if (url.includes("/rest/v1/treasury_workspaces")) {
      const row = { workspace: initialWorkspace, revision: 1 };
      return route.fulfill({ json: route.request().headers().accept?.includes("object") ? row : [row] });
    }
    return route.fulfill({ json: [] });
  });
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
  await page.getByLabel("Your command").fill("Hesabımı özetle"); await page.getByRole("button", { name: "Send command" }).click();
  await expect(page.getByText("4500 USDC", { exact: true })).toBeVisible(); expect(confirms).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("hoddie-change-review.png"), fullPage: true });
  expect(bodies[0]).toMatchObject({ mode: "MESSAGE", message: "Hesabımı özetle", provider: "AUTO" });
  expect(bodies[0]).not.toHaveProperty("messages"); expect(JSON.stringify(bodies[0])).not.toContain("4500");
  const apply = page.getByRole("button", { name: "Apply change" }); await apply.focus(); await apply.press("Enter");
  await expect(apply).toBeDisabled(); expect(confirms).toBe(1);
  await page.getByRole("link", { name: "Overview", exact: true }).filter({ visible: true }).first().click(); await page.goto("/hoddie");
  // A full document navigation deliberately clears memory; SPA navigation is tested below.
  await expect(page.getByText("Canonical server result")).toHaveCount(0);
  await page.getByLabel("Your command").fill("summary"); await page.getByRole("button", { name: "Send command" }).click();
  await expect(page.getByText("Canonical server result")).toBeVisible();
  await page.getByRole("link", { name: "Overview", exact: true }).filter({ visible: true }).first().click();
  await page.getByRole("link", { name: /^(Open )?Hoddie$/ }).filter({ visible: true }).first().click(); await expect(page.getByText("Canonical server result")).toBeVisible();
  await page.reload(); await expect(page.getByText("Canonical server result")).toHaveCount(0);
});
