import { expect, test } from "@playwright/test";
import { sampleWorkspace, usdc } from "../../src/lib/treasury/fixtures";
import { assessTreasury } from "../../src/lib/treasury/engine";
import { formatMoney } from "../../src/lib/treasury/format";

const routes = [["/", "Liquidity before yield."], ["/invest", "Deploy idle capital deliberately."], ["/obligations", "Know what is due."], ["/policy", "The rules behind every number."], ["/activity", "Every decision leaves a trace."], ["/connections", "Ask Hodd from Claude."]] as const;
for (const [route, heading] of routes) {
  test(`${route} shows an explicit read-only sample view without overflow`, async ({ page }) => {
    const errors: string[] = []; page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${route}?demo=1`);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByRole("note").filter({ hasText: "READ-ONLY DEMO · sample data · nothing is saved" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    expect(errors).toEqual([]);
  });
}

test("sample math remains stable; sample edits cannot be persisted from the demo", async ({ page }) => {
  // These are fixture scenarios, not editable user treasuries. Preserve the old
  // 6,500 / 2,500 / 7,000 / 2,000 / 4,000 assertions without unlocking demo writes.
  const scenario = structuredClone(sampleWorkspace);
  scenario.obligations.push({ ...scenario.obligations[0], id: "scenario-only", title: "Urgent invoice", amount: usdc("2000000000") });
  const at = new Date(sampleWorkspace.updatedAt);
  let assessment = assessTreasury(scenario, at);
  expect(formatMoney(assessment.upcomingObligations)).toBe("6,500.00 USDC"); expect(formatMoney(assessment.deployableCapital)).toBe("2,500.00 USDC");
  scenario.obligations.at(-1)!.amount = usdc("2500000000"); assessment = assessTreasury(scenario, at);
  expect(formatMoney(assessment.upcomingObligations)).toBe("7,000.00 USDC"); expect(formatMoney(assessment.deployableCapital)).toBe("2,000.00 USDC");
  expect(formatMoney(assessTreasury({ ...sampleWorkspace, policy: { ...sampleWorkspace.policy, safetyBuffer: usdc("1500000000") } }, at).deployableCapital)).toBe("4,000.00 USDC");

  await page.goto("/obligations?demo=1");
  await expect(page.getByText("4,500.00 USDC").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "New obligation", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Edit October payroll", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Delete October payroll", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /pay.*exit demo first/i }).first()).toBeDisabled();
  await page.reload(); await expect(page.getByRole("button", { name: "October payroll", exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("hodd.stage5.workspace.v4"))).toBeNull();
});

test("demo policy and targets are disabled while planning preview remains accessible", async ({ page }) => {
  await page.goto("/?demo=1"); await expect(page.getByRole("button", { name: "Edit policy", exact: true })).toBeDisabled();
  await page.goto("/policy"); await expect(page.getByLabel("Safety buffer", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /save policy and recalculate/i })).toBeDisabled();
  await page.goto("/invest"); await expect(page.getByLabel("Morpho target", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save targets", exact: true })).toBeDisabled();
  const trigger = page.getByRole("button", { name: /preview engine plan/i }); await trigger.click();
  await expect(page.getByRole("dialog", { name: "Allocation plan", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /preview only/i })).toBeDisabled();
  await page.getByRole("button", { name: /close investment preview/i }).click(); await expect(trigger).toBeFocused();
});

test("demo ignores corrupt stored workspaces and has no reset or persistence action", async ({ page }) => {
  await page.goto("/?demo=1"); await page.evaluate(() => localStorage.setItem("hodd.stage5.workspace.v4", "not-json")); await page.reload();
  await expect(page.getByRole("heading", { name: "Liquidity before yield." })).toBeVisible();
  await expect(page.getByRole("button", { name: /reset demo|start an empty treasury/i })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("hodd.stage5.workspace.v4"))).toBe("not-json");
});

test("sample activity details are keyboard accessible", async ({ page }) => {
  await page.goto("/activity?demo=1"); const disclosure = page.locator("summary").filter({ hasText: "Treasury Engine baseline evaluated" }).first();
  await disclosure.focus(); await disclosure.press("Enter"); await expect(page.getByText("Why this record exists").first()).toBeVisible();
});

test("sample obligation details follow the selected row and status filter", async ({ page }) => {
  await page.goto("/obligations?demo=1"); const plan = page.getByRole("complementary", { name: "Payment plan" });
  await expect(plan).toContainText(/plan for october payroll/i);
  await page.getByRole("button", { name: "AWS infrastructure", exact: true }).click(); await expect(plan).toContainText(/plan for aws infrastructure/i);
  await page.getByRole("button", { name: "DRAFT", exact: true }).click(); await expect(plan).toContainText(/plan for invoice #104/i);
  await expect(page.getByRole("button", { name: "October payroll", exact: true })).toHaveCount(0);
});

test("demo preference survives navigation and reload, and start-live exits it", async ({ page }) => {
  await page.goto("/?demo=1"); await page.getByRole("link", { name: "Activity", exact: true }).click();
  await page.reload(); await expect(page.getByRole("note").filter({ hasText: "READ-ONLY DEMO" })).toBeVisible();
  await page.getByRole("link", { name: "Start live testnet treasury" }).click(); await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("link", { name: "Return to treasury" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to start a live testnet treasury" })).toBeVisible();
});
