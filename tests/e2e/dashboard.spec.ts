import { expect, test } from "@playwright/test";

const routes = [
  ["/", "Liquidity before yield."],
  ["/invest", "Review idle capital."],
  ["/obligations", "Know what is due."],
  ["/activity", "Every decision leaves a trace."],
] as const;

for (const [route, heading] of routes) {
  test(`${route} renders without console errors or horizontal overflow`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByText(/sample data only|read-only in stage 1|all entries are demo records|apys and availability/i).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
    expect(errors).toEqual([]);
  });
}

test("investment preview is review-only", async ({ page }) => {
  await page.goto("/invest");
  const trigger = page.getByRole("button", { name: /preview sample plan/i });
  await trigger.click();
  await expect(page.getByRole("dialog", { name: /sample investment plan/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /execution unavailable/i })).toBeDisabled();
  await page.getByRole("button", { name: /close investment preview/i }).click();
  await expect(trigger).toBeFocused();
});

test("obligation filters and detail drawer work", async ({ page }) => {
  await page.goto("/obligations");
  await page.getByRole("button", { name: "DRAFT" }).click();
  await expect(page.getByText("Invoice #104")).toBeVisible();
  await page.getByRole("button", { name: /view details for invoice #104/i }).click();
  await expect(page.getByRole("dialog", { name: "Invoice #104" })).toBeVisible();
});

test("portfolio reflows at the 200 percent equivalent viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await expect(page.getByRole("heading", { name: "Liquidity before yield." })).toBeVisible();
});

test("activity details are keyboard accessible", async ({ page }) => {
  await page.goto("/activity");
  const disclosure = page.locator("summary").filter({ hasText: "Allocation recommendation prepared" });
  await expect(disclosure).toBeVisible();
  await disclosure.focus();
  await disclosure.press("Enter");
  await expect(page.getByText("Why this record exists").first()).toBeVisible();
});
